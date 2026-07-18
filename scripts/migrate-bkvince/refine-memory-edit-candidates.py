#!/usr/bin/env python3
"""Refine D2R memory-edit candidates by aligning complete legacy functions.

The coarse locator finds register-agnostic instruction n-grams in the target
image.  This second, read-only pass uses those clusters as seeds, aligns each
legacy function against local D2R 3.2 instruction streams, and maps the exact
legacy instruction containing each configured write site.

The output is evidence for review only.  It does not create patch JSON files or
write to a running process.
"""

from __future__ import annotations

import argparse
from collections import defaultdict
from dataclasses import dataclass
from difflib import SequenceMatcher
import json
from pathlib import Path
from statistics import median
from typing import Iterable

from capstone import CS_ARCH_X86, CS_MODE_64, Cs
import pefile

from locate_memory_edits_compat import (
    IMAGE_BASE,
    Instruction,
    disassemble,
    exception_ranges,
    find_containing_range,
    load_pending_sites,
)


@dataclass
class Alignment:
    seed_delta: int
    target_start: int
    target_end: int
    matching_old_instructions: int
    old_instruction_count: int
    blocks: list[tuple[int, int, int]]
    target_instructions: list[Instruction]

    @property
    def coverage(self) -> float:
        if not self.old_instruction_count:
            return 0.0
        return self.matching_old_instructions / self.old_instruction_count


def load_locator_module() -> None:
    """Compatibility stub replaced at runtime before this module executes."""


def section_bytes(pe: pefile.PE, name: bytes) -> tuple[int, bytes]:
    section = next(
        section for section in pe.sections if section.Name.rstrip(b"\0") == name
    )
    start = int(section.VirtualAddress)
    return start, pe.get_data(start, int(section.SizeOfRawData))


def candidate_deltas(paths: Iterable[Path]) -> dict[tuple[int, int], list[int]]:
    def parse_signed_hex(value: str) -> int:
        if value.startswith("0x-"):
            return -int(value[3:], 16)
        return int(value, 16)

    by_function: dict[tuple[int, int], list[int]] = defaultdict(list)
    for path in paths:
        payload = json.loads(path.read_text(encoding="utf-8"))
        seen: set[tuple[int, int]] = set()
        for site in payload["sites"]:
            function = site.get("legacyFunction")
            if not function:
                continue
            key = (int(function["start"], 16), int(function["end"], 16))
            if key in seen:
                continue
            seen.add(key)
            for candidate in site.get("functionCandidates", [])[:5]:
                low = parse_signed_hex(candidate["deltaMin"])
                high = parse_signed_hex(candidate["deltaMax"])
                by_function[key].append((low + high) // 2)
    return by_function


def merge_nearby_deltas(values: list[int], threshold: int = 0x1000) -> list[int]:
    if not values:
        return []
    clusters: list[list[int]] = [[value] for value in sorted(values)]
    merged = True
    while merged:
        merged = False
        output: list[list[int]] = []
        for cluster in clusters:
            if output and abs(median(cluster) - median(output[-1])) <= threshold:
                output[-1].extend(cluster)
                merged = True
            else:
                output.append(cluster)
        clusters = output
    ranked = sorted(clusters, key=len, reverse=True)
    return [int(median(cluster)) for cluster in ranked[:12]]


def align_at_seed(
    md: Cs,
    target_pe: pefile.PE,
    old: list[Instruction],
    seed_delta: int,
    margin: int,
) -> Alignment:
    predicted_start = max(0, old[0].rva + seed_delta)
    predicted_end = max(predicted_start, old[-1].rva + old[-1].size + seed_delta)
    window_start = max(0, predicted_start - margin)
    window_end = predicted_end + margin
    target = disassemble(
        md,
        target_pe.get_data(window_start, window_end - window_start),
        window_start,
    )
    matcher = SequenceMatcher(
        None,
        [instruction.token for instruction in old],
        [instruction.token for instruction in target],
        autojunk=False,
    )
    blocks = [
        (block.a, block.b, block.size)
        for block in matcher.get_matching_blocks()
        if block.size
    ]
    matching = sum(size for _, _, size in blocks)
    return Alignment(
        seed_delta=seed_delta,
        target_start=window_start,
        target_end=window_end,
        matching_old_instructions=matching,
        old_instruction_count=len(old),
        blocks=blocks,
        target_instructions=target,
    )


def mapped_instruction_index(
    old_index: int,
    old: list[Instruction],
    alignment: Alignment,
) -> tuple[int | None, str]:
    for old_start, target_start, size in alignment.blocks:
        if old_start <= old_index < old_start + size:
            return target_start + (old_index - old_start), "exact-matching-block"

    before = None
    after = None
    for block in alignment.blocks:
        old_start, target_start, size = block
        if old_start + size <= old_index:
            before = block
        elif old_start > old_index:
            after = block
            break

    predictions: list[int] = []
    if before:
        old_start, target_start, size = before
        predictions.append(target_start + size + old_index - (old_start + size))
    if after:
        old_start, target_start, _ = after
        predictions.append(target_start - (old_start - old_index))
    if not predictions:
        return None, "unmapped"

    predicted = round(sum(predictions) / len(predictions))
    token = old[old_index].token
    lower = max(0, predicted - 12)
    upper = min(len(alignment.target_instructions), predicted + 13)
    choices = [
        index
        for index in range(lower, upper)
        if alignment.target_instructions[index].token == token
    ]
    if choices:
        return min(choices, key=lambda index: abs(index - predicted)), "local-token"
    if 0 <= predicted < len(alignment.target_instructions):
        return predicted, "interpolated"
    return None, "unmapped"


def instruction_bytes(pe: pefile.PE, instruction: Instruction) -> str:
    return pe.get_data(instruction.rva, instruction.size).hex().upper()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--legacy-exe", type=Path, required=True)
    parser.add_argument("--target-exe", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--inventory", type=Path, required=True)
    parser.add_argument("--candidate", type=Path, action="append", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--margin", type=lambda value: int(value, 0), default=0x600)
    args = parser.parse_args()

    legacy_pe = pefile.PE(str(args.legacy_exe), fast_load=False)
    target_pe = pefile.PE(str(args.target_exe), fast_load=False)
    md = Cs(CS_ARCH_X86, CS_MODE_64)
    md.skipdata = True

    sites = load_pending_sites(args.manifest, args.inventory)
    ranges = exception_ranges(legacy_pe)
    by_function: dict[tuple[int, int], list] = defaultdict(list)
    data_sites = []
    for site in sites:
        containing = find_containing_range(ranges, site.legacy_rva)
        if not containing:
            data_sites.append(site)
            continue
        by_function[containing].append(site)

    seeds = candidate_deltas(args.candidate)
    function_results: dict[tuple[int, int], dict] = {}
    site_results: list[dict] = []

    for function, function_sites in by_function.items():
        start, end = function
        old = disassemble(md, legacy_pe.get_data(start, end - start), start)
        old_index_by_site = {}
        for site in function_sites:
            old_index_by_site[site.id] = next(
                (
                    index
                    for index, instruction in enumerate(old)
                    if instruction.rva
                    <= site.legacy_rva
                    < instruction.rva + instruction.size
                ),
                None,
            )

        alignments = [
            align_at_seed(md, target_pe, old, delta, args.margin)
            for delta in merge_nearby_deltas(seeds.get(function, []))
        ]
        alignments.sort(
            key=lambda alignment: (
                alignment.coverage,
                alignment.matching_old_instructions,
            ),
            reverse=True,
        )
        best = alignments[0] if alignments else None
        function_results[function] = {
            "legacyStart": f"0x{start:X}",
            "legacyEnd": f"0x{end:X}",
            "legacyInstructionCount": len(old),
            "seedCount": len(seeds.get(function, [])),
            "alignments": [
                {
                    "seedDelta": f"0x{alignment.seed_delta:X}",
                    "coverage": round(alignment.coverage, 4),
                    "matchingOldInstructions": alignment.matching_old_instructions,
                    "targetWindowStart": f"0x{alignment.target_start:X}",
                    "targetWindowEnd": f"0x{alignment.target_end:X}",
                }
                for alignment in alignments[:5]
            ],
        }

        for site in function_sites:
            old_index = old_index_by_site[site.id]
            mapped_index = None
            method = "unmapped"
            if best and old_index is not None:
                mapped_index, method = mapped_instruction_index(old_index, old, best)
            target_instruction = (
                best.target_instructions[mapped_index]
                if best is not None and mapped_index is not None
                else None
            )
            old_instruction = old[old_index] if old_index is not None else None
            site_results.append(
                {
                    "id": site.id,
                    "entryName": site.entry_name,
                    "legacyRva": f"0x{site.legacy_rva:X}",
                    "legacyFunction": {
                        "start": f"0x{start:X}",
                        "end": f"0x{end:X}",
                    },
                    "legacyInstruction": (
                        {
                            "rva": f"0x{old_instruction.rva:X}",
                            "bytes": instruction_bytes(legacy_pe, old_instruction),
                            "mnemonic": old_instruction.mnemonic,
                            "operands": old_instruction.operands,
                            "offsetWithinInstruction": site.legacy_rva
                            - old_instruction.rva,
                        }
                        if old_instruction
                        else None
                    ),
                    "functionCoverage": round(best.coverage, 4) if best else 0,
                    "mappingMethod": method,
                    "targetInstruction": (
                        {
                            "rva": f"0x{target_instruction.rva:X}",
                            "bytes": instruction_bytes(target_pe, target_instruction),
                            "mnemonic": target_instruction.mnemonic,
                            "operands": target_instruction.operands,
                        }
                        if target_instruction
                        else None
                    ),
                }
            )

    for site in data_sites:
        site_results.append(
            {
                "id": site.id,
                "entryName": site.entry_name,
                "legacyRva": f"0x{site.legacy_rva:X}",
                "legacyFunction": None,
                "legacyInstruction": None,
                "functionCoverage": 0,
                "mappingMethod": "data-or-no-unwind-record",
                "targetInstruction": None,
            }
        )

    output = {
        "version": 1,
        "method": "complete-function SequenceMatcher alignment seeded by 4/5/6-gram clusters",
        "counts": {
            "sites": len(site_results),
            "functions": len(by_function),
            "functionsWithSeeds": sum(1 for function in by_function if seeds.get(function)),
            "exactMappedSites": sum(
                1 for site in site_results if site["mappingMethod"] == "exact-matching-block"
            ),
            "locallyMappedSites": sum(
                1 for site in site_results if site["mappingMethod"] == "local-token"
            ),
            "interpolatedSites": sum(
                1 for site in site_results if site["mappingMethod"] == "interpolated"
            ),
            "unmappedSites": sum(
                1
                for site in site_results
                if site["mappingMethod"] in {"unmapped", "data-or-no-unwind-record"}
            ),
        },
        "functions": list(function_results.values()),
        "sites": site_results,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(output["counts"], indent=2))
    print(f"output={args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
