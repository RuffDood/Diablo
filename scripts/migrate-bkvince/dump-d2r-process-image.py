#!/usr/bin/env python3
"""Rebuild selected encrypted D2R PE sections from a decrypted process image.

The script only requests PROCESS_QUERY_INFORMATION and PROCESS_VM_READ. It never
writes to the target process. The output is an analysis copy outside the game
runtime; the source executable is never modified.
"""

from __future__ import annotations

import argparse
import ctypes
import hashlib
from pathlib import Path
from ctypes import wintypes

import pefile


PROCESS_VM_READ = 0x0010
PROCESS_QUERY_INFORMATION = 0x0400


def parse_int(value: str) -> int:
    return int(value, 0)


def read_process_bytes(handle: int, address: int, size: int) -> bytes:
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.ReadProcessMemory.argtypes = [
        wintypes.HANDLE,
        wintypes.LPCVOID,
        wintypes.LPVOID,
        ctypes.c_size_t,
        ctypes.POINTER(ctypes.c_size_t),
    ]
    kernel32.ReadProcessMemory.restype = wintypes.BOOL

    chunks: list[bytes] = []
    offset = 0
    chunk_size = 1024 * 1024
    while offset < size:
        requested = min(chunk_size, size - offset)
        buffer = (ctypes.c_ubyte * requested)()
        read = ctypes.c_size_t()
        ok = kernel32.ReadProcessMemory(
            handle,
            ctypes.c_void_p(address + offset),
            buffer,
            requested,
            ctypes.byref(read),
        )
        if not ok or read.value != requested:
            error = ctypes.get_last_error()
            raise OSError(
                error,
                f"ReadProcessMemory failed at 0x{address + offset:X}: "
                f"requested={requested} read={read.value}",
            )
        chunks.append(bytes(buffer))
        offset += requested
    return b"".join(chunks)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pid", type=int, required=True)
    parser.add_argument("--base", type=parse_int, default=0x140000000)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument(
        "--sections",
        default=".text,.rdata",
        help="Comma-separated PE section names to recover from memory.",
    )
    args = parser.parse_args()

    source_bytes = bytearray(args.source.read_bytes())
    pe = pefile.PE(data=bytes(source_bytes), fast_load=False)
    requested_sections = {name.strip() for name in args.sections.split(",")}

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel32.OpenProcess.restype = wintypes.HANDLE
    kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel32.CloseHandle.restype = wintypes.BOOL

    handle = kernel32.OpenProcess(
        PROCESS_QUERY_INFORMATION | PROCESS_VM_READ,
        False,
        args.pid,
    )
    if not handle:
        raise ctypes.WinError(ctypes.get_last_error())

    recovered: list[dict[str, object]] = []
    try:
        for section in pe.sections:
            name = section.Name.rstrip(b"\0").decode("ascii", errors="replace")
            if name not in requested_sections:
                continue
            raw_size = int(section.SizeOfRawData)
            memory_address = args.base + int(section.VirtualAddress)
            data = read_process_bytes(handle, memory_address, raw_size)
            start = int(section.PointerToRawData)
            end = start + raw_size
            source_bytes[start:end] = data
            recovered.append(
                {
                    "name": name,
                    "rva": f"0x{int(section.VirtualAddress):X}",
                    "size": raw_size,
                    "sha256": hashlib.sha256(data).hexdigest().upper(),
                }
            )
    finally:
        kernel32.CloseHandle(handle)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(source_bytes)
    print(f"output={args.output}")
    print(f"sha256={hashlib.sha256(source_bytes).hexdigest().upper()}")
    for item in recovered:
        print(
            f"section={item['name']} rva={item['rva']} size={item['size']} "
            f"sha256={item['sha256']}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
