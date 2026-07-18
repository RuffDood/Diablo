#!/usr/bin/env python3
"""Match individual D2R memory-edit instructions using anchored local context.

Whole-function matching is weakened by compiler outlining and merged functions.
This read-only pass anchors on the edited instruction, then independently
compares the instruction streams before and after it inside candidate target
functions.  Constants are preserved for semantic operands such as gold caps.
"""

from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from dataclasses import dataclass
from difflib import SequenceMatcher
import json
from pathlib import Path
import re
from typing import Iterable

from capstone import CS_ARCH_X86, CS_MODE_64, Cs
import pefile

from locate_memory_edits_compat import (
    Instruction,
    disassemble,
    exception_ranges,
    find_containing_range,
    iter_code_segments,
    load_pending_sites,
)
from match_memory_edit_functions_compat import (
    FunctionIndex,
    TargetFunction,
    load_target_functions,
    strict_token,
)


@dataclass
class Candidate:
    instruction: Instruction
    function: TargetFunction
    instructions: list[Instruction]
    index: int
    direct_scans: int
    seed_hits: int
    anchor_quality: float
    before_score: float
    after_score: float
    score: float


def coverage(old: list[str], new: list[str]) -> float:
    if not old:
        return 0.0
    matcher = SequenceMatcher(None, old, new, autojunk=False)
    return sum(block.size for block in matcher.get_matching_blocks()) / len(old)


def side_score(old: list[Instruction], new: list[Instruction]) -> float:
    if not old:
        return 0.0
    strict = coverage(
        [strict_token(instruction) for instruction in old],
        [strict_token(instruction) for instruction in new],
    )
    loose = coverage(
        [instruction.token for instruction in old],
        [instruction.token for instruction in new],
    )
    mnemonic = coverage(
        [instruction.mnemonic for instruction in old],
        [instruction.mnemonic for instruction in new],
    )
    return strict * 0.45 + loose * 0.35 + mnemonic * 0.20


def anchor_quality(old: Instruction, new: Instruction) -> float:
    if strict_token(old) == strict_token(new):
        return 1.0
    if old.token == new.token:
        return 0.78
    if old.mnemonic == new.mnemonic:
        return 0.42
    old_branch = old.mnemonic.startswith("j")
    new_branch = new.mnemonic.startswith("j")
    if old_branch and new_branch:
        return 0.20
    return 0.0


def load_reports(paths: Iterable[Path]) -> tuple[dict[str, Counter[int]], dict[str, list[int]]]:
    directs: dict[str, Counter[int]] = defaultdict(Counter)
    seeds: dict[str, list[int]] = defaultdict(list)
    for path in paths:
        payload = json.loads(path.read_text(encoding="utf-8"))
        for site in payload["sites"]:
            site_id = site["id"]
            for candidate in site.get("directCandidates", []):
                rva = int(candidate["rva"], 16)
                directs[site_id][rva] += 1
                seeds[site_id].append(rva)
            legacy_rva = int(site["legacyRva"], 16)
            for candidate in site.get("functionCandidates", [])[:5]:
                low_text = candidate["deltaMin"]
                high_text = candidate["deltaMax"]
                low = -int(low_text[3:], 16) if low_text.startswith("0x-") else int(low_text, 16)
                high = -int(high_text[3:], 16) if high_text.startswith("0x-") else int(high_text, 16)
                seeds[site_id].extend(
                    [
                        int(candidate["newStartMin"], 16),
                        int(candidate["newStartMax"], 16),
                        legacy_rva + (low + high) // 2,
                    ]
                )
    return directs, seeds


def global_strict_hits(
    md: Cs,
    target_pe: pefile.PE,
    wanted: set[str],
) -> dict[str, list[int]]:
    section = next(
        section
        for section in target_pe.sections
        if section.Name.rstrip(b"\0") == b".text"
    )
    start = int(section.VirtualAddress)
    code = target_pe.get_data(start, int(section.SizeOfRawData))
    output: dict[str, list[int]] = defaultdict(list)
    for segment_rva, segment in iter_code_segments(code, start):
        for instruction in disassemble(md, segment, segment_rva):
            token = strict_token(instruction)
            if token in wanted:
                output[token].append(instruction.rva)
    output = {
        token: addresses
        for token, addresses in output.items()
        if len(addresses) <= 500
    }
    return output


def find_instruction_index(instructions: list[Instruction], rva: int) -> int | None:
    for index, instruction in enumerate(instructions):
        if instruction.rva <= rva < instruction.rva + instruction.size:
            return index
    return None


def payload(pe: pefile.PE, instruction: Instruction) -> dict:
    return {
        "rva": f"0x{instruction.rva:X}",
        "bytes": pe.get_data(instruction.rva, instruction.size).hex().upper(),
        "mnemonic": instruction.mnemonic,
        "operands": instruction.operands,
        "strictToken": strict_token(instruction),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--legacy-exe", type=Path, required=True)
    parser.add_argument("--target-exe", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--inventory", type=Path, required=True)
    parser.add_argument("--candidate", type=Path, action="append", required=True)
    parser.add_argument("--target-functions", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--context", type=int, default=24)
    parser.add_argument("--entry-pattern")
    args = parser.parse_args()

    legacy_pe = pefile.PE(str(args.legacy_exe), fast_load=False)
    target_pe = pefile.PE(str(args.target_exe), fast_load=False)
    md = Cs(CS_ARCH_X86, CS_MODE_64)
    md.skipdata = True
    sites = load_pending_sites(args.manifest, args.inventory)
    if args.entry_pattern:
        pattern = re.compile(args.entry_pattern, re.IGNORECASE)
        sites = [site for site in sites if pattern.search(site.entry_name)]
    ranges = exception_ranges(legacy_pe)
    target_functions = load_target_functions(args.target_functions)
    target_function_map = {
        (function.start, function.end): function for function in target_functions
    }
    function_index = FunctionIndex(target_functions)
    directs, seeds = load_reports(args.candidate)

    old_context = {}
    wanted_strict = set()
    data_sites = []
    for site in sites:
        function = find_containing_range(ranges, site.legacy_rva)
        if not function:
            data_sites.append(site)
            continue
        start, end = function
        instructions = disassemble(md, legacy_pe.get_data(start, end - start), start)
        index = find_instruction_index(instructions, site.legacy_rva)
        if index is None:
            data_sites.append(site)
            continue
        old_context[site.id] = (site, function, instructions, index)
        instruction = instructions[index]
        if instruction.mnemonic != "call" and not instruction.mnemonic.startswith("j"):
            wanted_strict.add(strict_token(instruction))

    strict_hits = global_strict_hits(md, target_pe, wanted_strict)
    function_cache: dict[tuple[int, int], list[Instruction]] = {}
    results = []

    for site_id, (site, old_function, old, old_index) in old_context.items():
        old_instruction = old[old_index]
        function_hits = Counter()
        direct_function_hits = Counter()
        max_size = max(0x400, (old_function[1] - old_function[0]) * 8 + 0x1000)
        addresses = list(seeds.get(site_id, []))
        addresses.extend(strict_hits.get(strict_token(old_instruction), []))
        for address in addresses:
            for function in function_index.near(address, max_size):
                key = (function.start, function.end)
                function_hits[key] += 1
                if address in directs.get(site_id, {}):
                    direct_function_hits[key] += directs[site_id][address]

        ranked_function_keys = sorted(
            function_hits,
            key=lambda key: (direct_function_hits[key], function_hits[key]),
            reverse=True,
        )[:40]

        candidates = []
        old_before = old[max(0, old_index - args.context) : old_index]
        old_after = old[old_index + 1 : old_index + 1 + args.context]
        for key in ranked_function_keys:
            seed_count = function_hits[key]
            function = target_function_map[key]
            new = function_cache.get(key)
            if new is None:
                new = disassemble(
                    md,
                    target_pe.get_data(function.start, function.size),
                    function.start,
                )
                function_cache[key] = new
            anchored = []
            for new_index, new_instruction in enumerate(new):
                quality = anchor_quality(old_instruction, new_instruction)
                is_direct = any(
                    new_instruction.rva <= rva < new_instruction.rva + new_instruction.size
                    for rva in directs.get(site_id, {})
                )
                if quality < 0.42 and not is_direct:
                    continue
                anchored.append((quality, is_direct, new_index, new_instruction))
            anchored.sort(key=lambda item: (item[1], item[0]), reverse=True)
            for quality, is_direct, new_index, new_instruction in anchored[:8]:
                before = side_score(
                    old_before,
                    new[max(0, new_index - args.context * 2) : new_index],
                )
                after = side_score(
                    old_after,
                    new[new_index + 1 : new_index + 1 + args.context * 2],
                )
                direct_scans = sum(
                    scans
                    for rva, scans in directs.get(site_id, {}).items()
                    if new_instruction.rva <= rva < new_instruction.rva + new_instruction.size
                )
                score = (
                    quality * 0.27
                    + before * 0.31
                    + after * 0.31
                    + min(direct_scans, 3) / 3 * 0.08
                    + min(seed_count, 15) / 15 * 0.03
                )
                candidates.append(
                    Candidate(
                        instruction=new_instruction,
                        function=function,
                        instructions=new,
                        index=new_index,
                        direct_scans=direct_scans,
                        seed_hits=seed_count,
                        anchor_quality=quality,
                        before_score=before,
                        after_score=after,
                        score=score,
                    )
                )
        candidates.sort(key=lambda candidate: candidate.score, reverse=True)
        best = candidates[0] if candidates else None
        results.append(
            {
                "id": site.id,
                "entryName": site.entry_name,
                "legacyRva": f"0x{site.legacy_rva:X}",
                "legacyInstruction": payload(legacy_pe, old_instruction),
                "ranked": [
                    {
                        "targetFunction": f"0x{candidate.function.start:X}",
                        "targetInstruction": payload(target_pe, candidate.instruction),
                        "score": round(candidate.score, 5),
                        "anchorQuality": round(candidate.anchor_quality, 3),
                        "beforeScore": round(candidate.before_score, 5),
                        "afterScore": round(candidate.after_score, 5),
                        "directScans": candidate.direct_scans,
                        "seedHits": candidate.seed_hits,
                    }
                    for candidate in candidates[:12]
                ],
                "best": (
                    {
                        "targetFunction": f"0x{best.function.start:X}",
                        "targetInstruction": payload(target_pe, best.instruction),
                        "score": round(best.score, 5),
                        "margin": round(best.score - candidates[1].score, 5)
                        if len(candidates) > 1
                        else None,
                        "directScans": best.direct_scans,
                    }
                    if best
                    else None
                ),
            }
        )

    for site in data_sites:
        results.append(
            {
                "id": site.id,
                "entryName": site.entry_name,
                "legacyRva": f"0x{site.legacy_rva:X}",
                "legacyInstruction": None,
                "ranked": [],
                "best": None,
            }
        )

    output = {
        "version": 1,
        "method": "site-anchored strict/loose local context matching",
        "counts": {
            "sites": len(results),
            "matched": sum(1 for result in results if result["best"]),
            "unmatched": sum(1 for result in results if not result["best"]),
        },
        "sites": results,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(output["counts"], indent=2))
    print(f"output={args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
