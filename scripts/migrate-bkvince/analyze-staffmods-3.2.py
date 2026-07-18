#!/usr/bin/env python3
"""Inspect the D2R 3.2 staffmod generation routine in a decrypted image.

The helper is read-only. It uses the PE exception directory to recover the
function containing a known staffmod RVA, then prints a byte-accurate Capstone
disassembly suitable for documenting and reviewing candidate patches.
"""

from __future__ import annotations

import argparse
from pathlib import Path
import re

from capstone import CS_ARCH_X86, CS_MODE_64, Cs
import pefile


IMAGE_BASE = 0x140000000


def parse_int(value: str) -> int:
    return int(value, 0)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--image", type=Path, required=True)
    parser.add_argument("--anchor", type=parse_int, default=0x58AFCA)
    parser.add_argument("--start", type=parse_int)
    parser.add_argument("--end", type=parse_int)
    parser.add_argument(
        "--restore-anchor",
        default="7E0B",
        help="Original bytes to restore at the anchor before disassembly.",
    )
    args = parser.parse_args()

    pe = pefile.PE(str(args.image), fast_load=False)
    function = next(
        (
            (int(entry.struct.BeginAddress), int(entry.struct.EndAddress))
            for entry in getattr(pe, "DIRECTORY_ENTRY_EXCEPTION", [])
            if int(entry.struct.BeginAddress)
            <= args.anchor
            < int(entry.struct.EndAddress)
        ),
        None,
    )
    if function is None:
        text = next(
            section
            for section in pe.sections
            if section.Name.rstrip(b"\0") == b".text"
        )
        text_rva = int(text.VirtualAddress)
        text_data = pe.get_data(text_rva, int(text.SizeOfRawData))
        anchor_offset = args.anchor - text_rva
        search_start = max(0, anchor_offset - 0x10000)
        search_end = min(len(text_data), anchor_offset + 0x10000)
        padding = list(
            re.finditer(rb"\xCC{4,}", text_data[search_start:search_end])
        )
        before = [match for match in padding if search_start + match.end() <= anchor_offset]
        after = [match for match in padding if search_start + match.start() > anchor_offset]
        if not before or not after:
            raise RuntimeError(
                f"Unable to infer a padded function around RVA 0x{args.anchor:X}"
            )
        function = (
            text_rva + search_start + before[-1].end(),
            text_rva + search_start + after[0].start(),
        )

    start, end = function
    if args.start is not None:
        start = args.start
    if args.end is not None:
        end = args.end
    code = bytearray(pe.get_data(start, end - start))
    restore = bytes.fromhex(args.restore_anchor)
    offset = args.anchor - start
    if 0 <= offset <= len(code) - len(restore):
        code[offset : offset + len(restore)] = restore

    md = Cs(CS_ARCH_X86, CS_MODE_64)
    print(f"image={args.image}")
    print(f"anchor=0x{args.anchor:X}")
    print(f"function=0x{start:X}..0x{end:X} size=0x{end - start:X}")
    for instruction in md.disasm(code, IMAGE_BASE + start):
        rva = instruction.address - IMAGE_BASE
        marker = " ->" if rva <= args.anchor < rva + instruction.size else "   "
        encoded = instruction.bytes.hex(" ").upper()
        print(
            f"{marker} 0x{rva:08X}  {encoded:<32} "
            f"{instruction.mnemonic:<8} {instruction.op_str}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
