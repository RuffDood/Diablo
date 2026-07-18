#!/usr/bin/env python3
"""Locate legacy D2R memory-edit sites in a decrypted target executable.

This is a read-only reverse-engineering helper. It uses the legacy PE exception
table to recover function windows, builds register-agnostic instruction n-grams,
and searches a decrypted D2R 3.2 .text section for matching code regions.

The output contains candidates only. A candidate is not a patch and must still
be reviewed in disassembly before it can be marked as resolved.
"""

from __future__ import annotations

import argparse
from collections import Counter, defaultdict, deque
from dataclasses import dataclass
import json
from pathlib import Path
import re
from typing import Iterable

from capstone import CS_ARCH_X86, CS_MODE_64, Cs
import pefile


IMAGE_BASE = 0x140000000
PADDING_RE = re.compile(rb"(?:\xCC{4,}|\x00{16,})")
HEX_RE = re.compile(r"0x[0-9a-f]+")
DEC_RE = re.compile(r"(?<![a-z0-9_])-?\d+")

REGISTER_REPLACEMENTS = [
    (re.compile(r"\b(?:rip)\b"), "RIP"),
    (re.compile(r"\b(?:rsp)\b"), "SP64"),
    (re.compile(r"\b(?:esp)\b"), "SP32"),
    (re.compile(r"\b(?:sp)\b"), "SP16"),
    (re.compile(r"\b(?:spl)\b"), "SP8"),
    (re.compile(r"\b(?:rbp)\b"), "BP64"),
    (re.compile(r"\b(?:ebp)\b"), "BP32"),
    (re.compile(r"\b(?:bp)\b"), "BP16"),
    (re.compile(r"\b(?:bpl)\b"), "BP8"),
    (
        re.compile(
            r"\b(?:rax|rbx|rcx|rdx|rsi|rdi|r(?:8|9|1[0-5]))\b"
        ),
        "G64",
    ),
    (
        re.compile(
            r"\b(?:eax|ebx|ecx|edx|esi|edi|r(?:8|9|1[0-5])d)\b"
        ),
        "G32",
    ),
    (
        re.compile(r"\b(?:ax|bx|cx|dx|si|di|r(?:8|9|1[0-5])w)\b"),
        "G16",
    ),
    (
        re.compile(
            r"\b(?:al|ah|bl|bh|cl|ch|dl|dh|sil|dil|r(?:8|9|1[0-5])b)\b"
        ),
        "G8",
    ),
    (re.compile(r"\b(?:xmm(?:\d|[12]\d|3[01]))\b"), "XMM"),
    (re.compile(r"\b(?:ymm(?:\d|[12]\d|3[01]))\b"), "YMM"),
    (re.compile(r"\b(?:zmm(?:\d|[12]\d|3[01]))\b"), "ZMM"),
]


def parse_hex_rva(value: str) -> int:
    value = str(value).strip()
    return int(value, 16)


def normalize_number(text: str) -> str:
    negative = text.startswith("-")
    try:
        value = int(text, 16) if text.lstrip("-").startswith("0x") else int(text)
    except ValueError:
        return "NUM"
    absolute = abs(value)
    if absolute <= 0x1000:
        prefix = "-" if negative else ""
        return f"N{prefix}{absolute:X}"
    return "NUM"


def normalize_instruction(mnemonic: str, operands: str) -> str:
    mnemonic = mnemonic.lower()
    operands = operands.lower()
    if mnemonic == "call" or mnemonic.startswith("j") or mnemonic.startswith("loop"):
        if operands.startswith("qword ptr") or operands.startswith("dword ptr"):
            operands = re.sub(r"0x[0-9a-f]+", "NUM", operands)
        else:
            return mnemonic
    for pattern, replacement in REGISTER_REPLACEMENTS:
        operands = pattern.sub(replacement, operands)
    operands = HEX_RE.sub(lambda match: normalize_number(match.group(0)), operands)
    operands = DEC_RE.sub(lambda match: normalize_number(match.group(0)), operands)
    operands = re.sub(r"\s+", "", operands)
    return f"{mnemonic}:{operands}"


@dataclass(frozen=True)
class Instruction:
    rva: int
    size: int
    mnemonic: str
    operands: str
    token: str


@dataclass
class Site:
    id: str
    entry_name: str
    legacy_rva: int
    length: int
    function_start: int | None = None
    function_end: int | None = None
    instruction_index: int | None = None
    instruction: Instruction | None = None


def disassemble(md: Cs, code: bytes, start_rva: int) -> list[Instruction]:
    return [
        Instruction(
            rva=address - IMAGE_BASE,
            size=size,
            mnemonic=mnemonic,
            operands=operands,
            token=normalize_instruction(mnemonic, operands),
        )
        for address, size, mnemonic, operands in md.disasm_lite(
            code, IMAGE_BASE + start_rva
        )
    ]


def load_pending_sites(manifest_path: Path, inventory_path: Path) -> list[Site]:
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    inventory = json.loads(inventory_path.read_text(encoding="utf-8"))
    statuses = {
        item["name"]: item["status"]
        for item in inventory.get("legacyStatusOverrides", [])
    }
    sites: list[Site] = []
    for entry in manifest["MemoryConfigs"]:
        if statuses.get(entry["Name"]) in {"ported", "not-applicable"}:
            continue
        addresses = entry.get("Addresses") or [entry.get("Address")]
        for index, address in enumerate(addresses):
            if not address:
                continue
            sites.append(
                Site(
                    id=f"manifest:{entry['Name']}:{index}",
                    entry_name=entry["Name"],
                    legacy_rva=parse_hex_rva(address),
                    length=int(entry["Length"]),
                )
            )
    for entry in inventory.get("supplementalCandidates", []):
        if entry.get("status") in {"ported", "not-applicable", "cancelled"}:
            continue
        for index, address in enumerate(entry.get("addresses", [])):
            sites.append(
                Site(
                    id=f"supplemental:{entry['name']}:{index}",
                    entry_name=entry["name"],
                    legacy_rva=parse_hex_rva(address),
                    length=int(entry["sizeBytes"]),
                )
            )
    return sites


def exception_ranges(pe: pefile.PE) -> list[tuple[int, int]]:
    return [
        (int(entry.struct.BeginAddress), int(entry.struct.EndAddress))
        for entry in pe.DIRECTORY_ENTRY_EXCEPTION
    ]


def find_containing_range(
    ranges: list[tuple[int, int]], rva: int
) -> tuple[int, int] | None:
    low = 0
    high = len(ranges)
    while low < high:
        middle = (low + high) // 2
        start, end = ranges[middle]
        if rva < start:
            high = middle
        elif rva >= end:
            low = middle + 1
        else:
            return start, end
    return None


def iter_code_segments(code: bytes, text_rva: int) -> Iterable[tuple[int, bytes]]:
    cursor = 0
    for match in PADDING_RE.finditer(code):
        if match.start() > cursor:
            yield text_rva + cursor, code[cursor : match.start()]
        cursor = match.end()
    if cursor < len(code):
        yield text_rva + cursor, code[cursor:]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--legacy-exe", type=Path, required=True)
    parser.add_argument("--target-exe", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--inventory", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--ngram", type=int, default=5)
    args = parser.parse_args()

    legacy_pe = pefile.PE(str(args.legacy_exe), fast_load=False)
    target_pe = pefile.PE(str(args.target_exe), fast_load=False)
    md = Cs(CS_ARCH_X86, CS_MODE_64)
    md.skipdata = True

    sites = load_pending_sites(args.manifest, args.inventory)
    ranges = exception_ranges(legacy_pe)
    text_section = next(
        section
        for section in legacy_pe.sections
        if section.Name.rstrip(b"\0") == b".text"
    )
    legacy_text_start = int(text_section.VirtualAddress)
    legacy_text_end = legacy_text_start + int(text_section.Misc_VirtualSize)

    functions: dict[tuple[int, int], list[Instruction]] = {}
    function_sites: dict[tuple[int, int], list[Site]] = defaultdict(list)
    data_sites: list[Site] = []
    for site in sites:
        if not (legacy_text_start <= site.legacy_rva < legacy_text_end):
            data_sites.append(site)
            continue
        containing = find_containing_range(ranges, site.legacy_rva)
        if containing is None:
            data_sites.append(site)
            continue
        site.function_start, site.function_end = containing
        if containing not in functions:
            start, end = containing
            functions[containing] = disassemble(
                md, legacy_pe.get_data(start, end - start), start
            )
        instructions = functions[containing]
        for index, instruction in enumerate(instructions):
            if instruction.rva <= site.legacy_rva < instruction.rva + instruction.size:
                site.instruction_index = index
                site.instruction = instruction
                break
        function_sites[containing].append(site)

    ngram_size = args.ngram
    raw_references: dict[tuple[str, ...], list[tuple[tuple[int, int], int]]] = (
        defaultdict(list)
    )
    for function_key, instructions in functions.items():
        tokens = [instruction.token for instruction in instructions]
        for index in range(0, len(tokens) - ngram_size + 1):
            raw_references[tuple(tokens[index : index + ngram_size])].append(
                (function_key, index)
            )

    references = {
        key: value
        for key, value in raw_references.items()
        if len(value) <= 3 and len({token.split(":", 1)[0] for token in key}) >= 3
    }

    target_text = next(
        section
        for section in target_pe.sections
        if section.Name.rstrip(b"\0") == b".text"
    )
    target_text_rva = int(target_text.VirtualAddress)
    target_code = target_pe.get_data(target_text_rva, int(target_text.SizeOfRawData))

    function_matches: dict[
        tuple[int, int], list[tuple[int, int, int]]
    ] = defaultdict(list)
    site_votes: dict[str, Counter[int]] = defaultdict(Counter)
    scanned_instructions = 0
    matched_ngrams = 0

    for segment_rva, segment in iter_code_segments(target_code, target_text_rva):
        window: deque[Instruction] = deque(maxlen=ngram_size)
        for address, size, mnemonic, operands in md.disasm_lite(
            segment, IMAGE_BASE + segment_rva
        ):
            scanned_instructions += 1
            instruction = Instruction(
                rva=address - IMAGE_BASE,
                size=size,
                mnemonic=mnemonic,
                operands=operands,
                token=normalize_instruction(mnemonic, operands),
            )
            window.append(instruction)
            if len(window) != ngram_size:
                continue
            key = tuple(item.token for item in window)
            old_refs = references.get(key)
            if not old_refs:
                continue
            matched_ngrams += 1
            new_window = tuple(window)
            for function_key, old_index in old_refs:
                old_instructions = functions[function_key]
                old_rva = old_instructions[old_index].rva
                new_rva = new_window[0].rva
                function_matches[function_key].append((new_rva, old_rva, old_index))
                for site in function_sites[function_key]:
                    if site.instruction_index is None:
                        continue
                    relative_index = site.instruction_index - old_index
                    if 0 <= relative_index < ngram_size:
                        site_votes[site.id][new_window[relative_index].rva] += 1

    results: list[dict[str, object]] = []
    for site in sites:
        vote_counter = site_votes.get(site.id, Counter())
        direct_candidates = [
            {"rva": f"0x{rva:X}", "votes": votes}
            for rva, votes in vote_counter.most_common(10)
        ]
        function_candidates: list[dict[str, object]] = []
        if site.function_start is not None and site.function_end is not None:
            function_key = (site.function_start, site.function_end)
            matches = function_matches.get(function_key, [])
            bins: dict[int, list[tuple[int, int, int]]] = defaultdict(list)
            for new_rva, old_rva, old_index in matches:
                bins[(new_rva - old_rva) // 0x1000].append(
                    (new_rva, old_rva, old_index)
                )
            ranked_bins = sorted(
                bins.values(),
                key=lambda items: len({item[2] for item in items}),
                reverse=True,
            )
            for cluster in ranked_bins[:5]:
                function_candidates.append(
                    {
                        "newStartMin": f"0x{min(item[0] for item in cluster):X}",
                        "newStartMax": f"0x{max(item[0] for item in cluster):X}",
                        "uniqueLegacyNgrams": len({item[2] for item in cluster}),
                        "matches": len(cluster),
                        "deltaMin": f"0x{min(item[0] - item[1] for item in cluster):X}",
                        "deltaMax": f"0x{max(item[0] - item[1] for item in cluster):X}",
                    }
                )
        results.append(
            {
                "id": site.id,
                "entryName": site.entry_name,
                "legacyRva": f"0x{site.legacy_rva:X}",
                "legacyLength": site.length,
                "legacyFunction": (
                    {
                        "start": f"0x{site.function_start:X}",
                        "end": f"0x{site.function_end:X}",
                    }
                    if site.function_start is not None
                    else None
                ),
                "legacyInstruction": (
                    {
                        "rva": f"0x{site.instruction.rva:X}",
                        "size": site.instruction.size,
                        "mnemonic": site.instruction.mnemonic,
                        "operands": site.instruction.operands,
                        "offsetWithinInstruction": site.legacy_rva
                        - site.instruction.rva,
                    }
                    if site.instruction is not None
                    else None
                ),
                "directCandidates": direct_candidates,
                "functionCandidates": function_candidates,
            }
        )

    output = {
        "version": 1,
        "method": {
            "ngramSize": ngram_size,
            "indexedLegacyFunctions": len(functions),
            "indexedNgrams": len(references),
            "scannedTargetInstructions": scanned_instructions,
            "matchedTargetNgrams": matched_ngrams,
        },
        "counts": {
            "sites": len(sites),
            "codeSites": len(sites) - len(data_sites),
            "dataOrUnwindlessSites": len(data_sites),
            "sitesWithDirectCandidates": sum(
                1 for result in results if result["directCandidates"]
            ),
        },
        "sites": results,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(output["method"], indent=2))
    print(json.dumps(output["counts"], indent=2))
    print(f"output={args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
