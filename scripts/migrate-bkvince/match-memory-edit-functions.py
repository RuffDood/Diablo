#!/usr/bin/env python3
"""Rank target D2R functions for every pending legacy memory-edit function.

This read-only helper consumes the coarse 4/5/6-gram candidate reports and a
slim Rizin function inventory.  Candidate target functions are compared using
strict constants, loose register-agnostic tokens, mnemonic sequences, size,
and control-flow shape.  It maps legacy edit instructions only after choosing
a complete target function.
"""

from __future__ import annotations

import argparse
from bisect import bisect_right
from collections import defaultdict
from dataclasses import dataclass
from difflib import SequenceMatcher
import json
from pathlib import Path
import re
import struct
from typing import Iterable

from capstone import CS_ARCH_X86, CS_MODE_64, Cs
import pefile

from locate_memory_edits_compat import (
    IMAGE_BASE,
    Instruction,
    REGISTER_REPLACEMENTS,
    disassemble,
    exception_ranges,
    find_containing_range,
    load_pending_sites,
)


NUMBER_RE = re.compile(r"0x[0-9a-f]+|(?<![a-z0-9_])-?\d+")
RIP_NUMBER_RE = re.compile(r"(?<=rip[+-])(?:0x[0-9a-f]+|\d+)")


def strict_token(instruction: Instruction) -> str:
    mnemonic = instruction.mnemonic.lower()
    operands = instruction.operands.lower().replace(" ", "")
    if mnemonic == "call" or mnemonic.startswith("j") or mnemonic.startswith("loop"):
        return mnemonic
    for pattern, replacement in REGISTER_REPLACEMENTS:
        operands = pattern.sub(replacement, operands)
    operands = RIP_NUMBER_RE.sub("REL", operands)
    operands = NUMBER_RE.sub(
        lambda match: (
            "ADDR"
            if abs(int(match.group(0), 0)) >= IMAGE_BASE
            else match.group(0)
        ),
        operands,
    )
    return f"{mnemonic}:{operands}"


@dataclass(frozen=True)
class TargetFunction:
    start: int
    end: int
    size: int
    nbbs: int
    edges: int
    cc: int
    loops: int


@dataclass
class ScoredCandidate:
    function: TargetFunction
    instructions: list[Instruction]
    score: float
    strict_coverage: float
    loose_coverage: float
    mnemonic_coverage: float
    strict_ngram_coverage: float
    loose_ngram_coverage: float
    mnemonic_ngram_coverage: float
    site_token_coverage: float
    size_ratio: float
    seed_hits: int
    value_hits: int
    strict_blocks: list[tuple[int, int, int]]
    loose_blocks: list[tuple[int, int, int]]


def signed_hex(value: str) -> int:
    if value.startswith("0x-"):
        return -int(value[3:], 16)
    return int(value, 16)


def load_target_functions(path: Path) -> list[TargetFunction]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    functions = {}
    for item in raw:
        absolute_start = int(item.get("offset") or 0)
        if absolute_start < IMAGE_BASE:
            continue
        start = absolute_start - IMAGE_BASE
        size = int(item.get("realsz") or item.get("size") or 0)
        if size < 2 or size > 0x100000:
            continue
        end = start + size
        function = TargetFunction(
            start=start,
            end=end,
            size=size,
            nbbs=int(item.get("nbbs") or 0),
            edges=int(item.get("edges") or 0),
            cc=int(item.get("cc") or 0),
            loops=int(item.get("loops") or 0),
        )
        previous = functions.get((start, end))
        if previous is None or function.nbbs > previous.nbbs:
            functions[(start, end)] = function
    return sorted(functions.values(), key=lambda function: (function.start, function.end))


class FunctionIndex:
    def __init__(self, functions: list[TargetFunction]):
        self.functions = functions
        self.starts = [function.start for function in functions]

    def near(self, rva: int, max_size: int) -> list[TargetFunction]:
        index = bisect_right(self.starts, rva)
        output = []
        for function in self.functions[max(0, index - 80) : min(len(self.functions), index + 8)]:
            if function.start <= rva < function.end and function.size <= max_size:
                output.append(function)
        if output:
            return output
        # Some heuristic functions end just before a seed located in a tail
        # block. Include the nearest starts as a fallback.
        return [
            function
            for function in self.functions[max(0, index - 6) : index + 3]
            if function.size <= max_size
        ]


def candidate_seed_addresses(paths: Iterable[Path]) -> dict[tuple[int, int], list[int]]:
    output: dict[tuple[int, int], list[int]] = defaultdict(list)
    for path in paths:
        payload = json.loads(path.read_text(encoding="utf-8"))
        for site in payload["sites"]:
            legacy_function = site.get("legacyFunction")
            if not legacy_function:
                continue
            key = (
                int(legacy_function["start"], 16),
                int(legacy_function["end"], 16),
            )
            output[key].extend(
                int(candidate["rva"], 16)
                for candidate in site.get("directCandidates", [])
            )
            legacy_rva = int(site["legacyRva"], 16)
            for candidate in site.get("functionCandidates", [])[:5]:
                delta = (
                    signed_hex(candidate["deltaMin"])
                    + signed_hex(candidate["deltaMax"])
                ) // 2
                output[key].append(legacy_rva + delta)
                output[key].append(int(candidate["newStartMin"], 16))
                output[key].append(int(candidate["newStartMax"], 16))
    return output


def load_original_patterns(manifest_path: Path, inventory_path: Path) -> dict[str, bytes]:
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    inventory = json.loads(inventory_path.read_text(encoding="utf-8"))
    patterns = {}
    for entry in manifest["MemoryConfigs"]:
        value = entry.get("OriginalValues")
        if value is None:
            continue
        length = int(entry["Length"])
        if str(entry.get("Type", "Hex")).lower() == "integer":
            patterns[entry["Name"]] = int(value).to_bytes(length, "little", signed=False)
        else:
            patterns[entry["Name"]] = bytes.fromhex(str(value))
    for entry in inventory.get("supplementalCandidates", []):
        value = entry.get("original")
        if value is None:
            continue
        length = int(entry["sizeBytes"])
        if str(entry.get("format", "hex")).lower() == "integer":
            patterns[entry["name"]] = int(value).to_bytes(length, "little", signed=False)
        else:
            patterns[entry["name"]] = bytes.fromhex(str(value))
    return patterns


def pattern_hits_by_entry(
    target_pe: pefile.PE,
    patterns: dict[str, bytes],
) -> dict[str, list[int]]:
    section = next(
        section
        for section in target_pe.sections
        if section.Name.rstrip(b"\0") == b".text"
    )
    start = int(section.VirtualAddress)
    code = target_pe.get_data(start, int(section.SizeOfRawData))
    output = {}
    for name, pattern in patterns.items():
        if len(pattern) < 2:
            continue
        hits = []
        cursor = 0
        while True:
            cursor = code.find(pattern, cursor)
            if cursor < 0:
                break
            hits.append(start + cursor)
            cursor += 1
            if len(hits) > 2000:
                hits = []
                break
        if hits:
            output[name] = hits
    return output


def matching_coverage(a: list[str], b: list[str]) -> tuple[float, list[tuple[int, int, int]]]:
    matcher = SequenceMatcher(None, a, b, autojunk=False)
    blocks = [
        (block.a, block.b, block.size)
        for block in matcher.get_matching_blocks()
        if block.size
    ]
    matched = sum(size for _, _, size in blocks)
    return (matched / len(a) if a else 0.0), blocks


def ngram_coverage(a: list[str], b: list[str], size: int) -> float:
    if len(a) < size or len(b) < size:
        return 0.0
    old = {tuple(a[index : index + size]) for index in range(len(a) - size + 1)}
    new = {tuple(b[index : index + size]) for index in range(len(b) - size + 1)}
    return len(old & new) / len(old) if old else 0.0


def branch_count(instructions: list[Instruction]) -> int:
    return sum(
        1
        for instruction in instructions
        if instruction.mnemonic.startswith("j")
        or instruction.mnemonic.startswith("loop")
    )


def call_count(instructions: list[Instruction]) -> int:
    return sum(1 for instruction in instructions if instruction.mnemonic == "call")


def score_candidate(
    old: list[Instruction],
    new: list[Instruction],
    function: TargetFunction,
    seed_hits: int,
    value_hits: int,
    old_site_indices: list[int],
) -> ScoredCandidate:
    old_strict = [strict_token(instruction) for instruction in old]
    new_strict = [strict_token(instruction) for instruction in new]
    strict_coverage, strict_blocks = matching_coverage(old_strict, new_strict)
    loose_coverage, loose_blocks = matching_coverage(
        [instruction.token for instruction in old],
        [instruction.token for instruction in new],
    )
    mnemonic_coverage, _ = matching_coverage(
        [instruction.mnemonic for instruction in old],
        [instruction.mnemonic for instruction in new],
    )
    old_loose = [instruction.token for instruction in old]
    new_loose = [instruction.token for instruction in new]
    old_mnemonics = [instruction.mnemonic for instruction in old]
    new_mnemonics = [instruction.mnemonic for instruction in new]
    strict_ngram_coverage = ngram_coverage(old_strict, new_strict, 2)
    loose_ngram_coverage = ngram_coverage(old_loose, new_loose, 3)
    mnemonic_ngram_coverage = ngram_coverage(old_mnemonics, new_mnemonics, 5)
    new_strict_set = set(new_strict)
    new_loose_set = set(new_loose)
    site_matches = sum(
        1
        for index in old_site_indices
        if old_strict[index] in new_strict_set or old_loose[index] in new_loose_set
    )
    site_token_coverage = site_matches / len(old_site_indices) if old_site_indices else 0
    size_ratio = min(len(old), len(new)) / max(len(old), len(new)) if old and new else 0
    old_branches = branch_count(old)
    old_calls = call_count(old)
    new_branches = branch_count(new)
    new_calls = call_count(new)
    branch_ratio = min(old_branches + 1, new_branches + 1) / max(old_branches + 1, new_branches + 1)
    call_ratio = min(old_calls + 1, new_calls + 1) / max(old_calls + 1, new_calls + 1)
    score = (
        strict_coverage * 0.18
        + loose_coverage * 0.12
        + mnemonic_coverage * 0.08
        + strict_ngram_coverage * 0.16
        + loose_ngram_coverage * 0.14
        + mnemonic_ngram_coverage * 0.08
        + site_token_coverage * 0.09
        + size_ratio * 0.05
        + branch_ratio * 0.035
        + call_ratio * 0.025
        + min(seed_hits, 9) / 9 * 0.02
        + min(value_hits, 3) / 3 * 0.08
    )
    return ScoredCandidate(
        function=function,
        instructions=new,
        score=score,
        strict_coverage=strict_coverage,
        loose_coverage=loose_coverage,
        mnemonic_coverage=mnemonic_coverage,
        strict_ngram_coverage=strict_ngram_coverage,
        loose_ngram_coverage=loose_ngram_coverage,
        mnemonic_ngram_coverage=mnemonic_ngram_coverage,
        site_token_coverage=site_token_coverage,
        size_ratio=size_ratio,
        seed_hits=seed_hits,
        value_hits=value_hits,
        strict_blocks=strict_blocks,
        loose_blocks=loose_blocks,
    )


def map_index(
    old_index: int,
    blocks: list[tuple[int, int, int]],
    old: list[Instruction],
    new: list[Instruction],
) -> tuple[int | None, str]:
    for old_start, new_start, size in blocks:
        if old_start <= old_index < old_start + size:
            return new_start + old_index - old_start, "exact-strict-block"
    before = None
    after = None
    for block in blocks:
        if block[0] + block[2] <= old_index:
            before = block
        elif block[0] > old_index:
            after = block
            break
    predictions = []
    if before:
        predictions.append(before[1] + before[2] + old_index - before[0] - before[2])
    if after:
        predictions.append(after[1] - (after[0] - old_index))
    if not predictions:
        return None, "unmapped"
    predicted = round(sum(predictions) / len(predictions))
    strict = strict_token(old[old_index])
    loose = old[old_index].token
    choices = []
    for index in range(max(0, predicted - 20), min(len(new), predicted + 21)):
        candidate = new[index]
        if strict_token(candidate) == strict:
            choices.append((0, abs(index - predicted), index, "local-strict-token"))
        elif candidate.token == loose:
            choices.append((1, abs(index - predicted), index, "local-loose-token"))
        elif candidate.mnemonic == old[old_index].mnemonic:
            choices.append((2, abs(index - predicted), index, "local-mnemonic"))
    if choices:
        _, _, index, method = min(choices)
        return index, method
    return (predicted, "interpolated") if 0 <= predicted < len(new) else (None, "unmapped")


def insn_payload(pe: pefile.PE, instruction: Instruction) -> dict:
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
    args = parser.parse_args()

    legacy_pe = pefile.PE(str(args.legacy_exe), fast_load=False)
    target_pe = pefile.PE(str(args.target_exe), fast_load=False)
    md = Cs(CS_ARCH_X86, CS_MODE_64)
    md.skipdata = True

    sites = load_pending_sites(args.manifest, args.inventory)
    legacy_ranges = exception_ranges(legacy_pe)
    by_function = defaultdict(list)
    data_sites = []
    for site in sites:
        function = find_containing_range(legacy_ranges, site.legacy_rva)
        if function:
            by_function[function].append(site)
        else:
            data_sites.append(site)

    target_functions = load_target_functions(args.target_functions)
    function_index = FunctionIndex(target_functions)
    seeds = candidate_seed_addresses(args.candidate)
    original_patterns = load_original_patterns(args.manifest, args.inventory)
    value_addresses = pattern_hits_by_entry(target_pe, original_patterns)
    results = []
    function_results = []

    for legacy_function, function_sites in by_function.items():
        old_start, old_end = legacy_function
        old = disassemble(md, legacy_pe.get_data(old_start, old_end - old_start), old_start)
        old_site_indices = []
        for site in function_sites:
            index = next(
                (
                    index
                    for index, instruction in enumerate(old)
                    if instruction.rva <= site.legacy_rva < instruction.rva + instruction.size
                ),
                None,
            )
            if index is not None:
                old_site_indices.append(index)
        max_target_size = max(0x200, (old_end - old_start) * 5 + 0x800)
        seed_hits = defaultdict(int)
        value_hits = defaultdict(int)
        candidate_functions = {}
        for address in seeds.get(legacy_function, []):
            for function in function_index.near(address, max_target_size):
                candidate_functions[(function.start, function.end)] = function
                seed_hits[(function.start, function.end)] += 1

        for site in function_sites:
            for address in value_addresses.get(site.entry_name, []):
                for function in function_index.near(address, max_target_size):
                    candidate_functions[(function.start, function.end)] = function
                    value_hits[(function.start, function.end)] += 1

        scored = []
        for key, function in candidate_functions.items():
            new = disassemble(
                md,
                target_pe.get_data(function.start, function.size),
                function.start,
            )
            if not new:
                continue
            scored.append(
                score_candidate(
                    old,
                    new,
                    function,
                    seed_hits[key],
                    value_hits[key],
                    old_site_indices,
                )
            )
        scored.sort(key=lambda item: item.score, reverse=True)
        best = scored[0] if scored else None
        function_results.append(
            {
                "legacyStart": f"0x{old_start:X}",
                "legacyEnd": f"0x{old_end:X}",
                "legacySize": old_end - old_start,
                "legacyInstructionCount": len(old),
                "seedAddresses": len(seeds.get(legacy_function, [])),
                "candidateFunctions": len(scored),
                "ranked": [
                    {
                        "targetStart": f"0x{item.function.start:X}",
                        "targetEnd": f"0x{item.function.end:X}",
                        "targetSize": item.function.size,
                        "targetInstructionCount": len(item.instructions),
                        "score": round(item.score, 5),
                        "strictCoverage": round(item.strict_coverage, 5),
                        "looseCoverage": round(item.loose_coverage, 5),
                        "mnemonicCoverage": round(item.mnemonic_coverage, 5),
                        "strictNgramCoverage": round(item.strict_ngram_coverage, 5),
                        "looseNgramCoverage": round(item.loose_ngram_coverage, 5),
                        "mnemonicNgramCoverage": round(item.mnemonic_ngram_coverage, 5),
                        "siteTokenCoverage": round(item.site_token_coverage, 5),
                        "sizeRatio": round(item.size_ratio, 5),
                        "seedHits": item.seed_hits,
                        "valueHits": item.value_hits,
                        "nbbs": item.function.nbbs,
                        "edges": item.function.edges,
                    }
                    for item in scored[:10]
                ],
            }
        )

        for site in function_sites:
            old_index = next(
                (
                    index
                    for index, instruction in enumerate(old)
                    if instruction.rva <= site.legacy_rva < instruction.rva + instruction.size
                ),
                None,
            )
            mapped_index = None
            method = "unmapped"
            if best is not None and old_index is not None:
                mapped_index, method = map_index(
                    old_index,
                    best.strict_blocks,
                    old,
                    best.instructions,
                )
            old_instruction = old[old_index] if old_index is not None else None
            new_instruction = (
                best.instructions[mapped_index]
                if best is not None and mapped_index is not None
                else None
            )
            results.append(
                {
                    "id": site.id,
                    "entryName": site.entry_name,
                    "legacyRva": f"0x{site.legacy_rva:X}",
                    "legacyFunction": {
                        "start": f"0x{old_start:X}",
                        "end": f"0x{old_end:X}",
                    },
                    "legacyInstruction": insn_payload(legacy_pe, old_instruction)
                    if old_instruction
                    else None,
                    "targetFunction": (
                        {
                            "start": f"0x{best.function.start:X}",
                            "end": f"0x{best.function.end:X}",
                            "score": round(best.score, 5),
                            "strictCoverage": round(best.strict_coverage, 5),
                            "scoreMargin": round(best.score - scored[1].score, 5)
                            if len(scored) > 1
                            else None,
                        }
                        if best
                        else None
                    ),
                    "mappingMethod": method,
                    "targetInstruction": insn_payload(target_pe, new_instruction)
                    if new_instruction
                    else None,
                }
            )

    for site in data_sites:
        results.append(
            {
                "id": site.id,
                "entryName": site.entry_name,
                "legacyRva": f"0x{site.legacy_rva:X}",
                "legacyFunction": None,
                "legacyInstruction": None,
                "targetFunction": None,
                "mappingMethod": "data-or-no-unwind-record",
                "targetInstruction": None,
            }
        )

    payload = {
        "version": 1,
        "method": "Rizin target-function ranking with strict/loose/mnemonic alignment",
        "counts": {
            "targetFunctions": len(target_functions),
            "legacyFunctions": len(by_function),
            "sites": len(results),
            "mappedSites": sum(1 for result in results if result["targetInstruction"]),
            "exactStrictSites": sum(
                1 for result in results if result["mappingMethod"] == "exact-strict-block"
            ),
            "unmappedSites": sum(1 for result in results if not result["targetInstruction"]),
        },
        "functions": function_results,
        "sites": results,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(payload["counts"], indent=2))
    print(f"output={args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
