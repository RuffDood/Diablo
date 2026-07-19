#!/usr/bin/env python3
"""Fast, persistent queries for the governed D2R 3.2.92777 image."""

from __future__ import annotations

import argparse
import bisect
import hashlib
import json
import os
import re
import sqlite3
import struct
import sys
import tempfile
from pathlib import Path
from typing import Any, Iterable, Iterator

try:
    import capstone
    from capstone import x86_const
    import pefile
except ImportError as exc:  # pragma: no cover - environment diagnostic
    raise SystemExit(
        f"Missing reverse-engineering dependency: {exc.name}. "
        "Install pefile and capstone for the selected Python interpreter."
    ) from exc


REPO_ROOT = Path(__file__).resolve().parents[2]
WORKBENCH_ROOT = REPO_ROOT / "reverse-engineering" / "d2r-3.2.92777"
CONFIG_PATH = WORKBENCH_ROOT / "workbench.json"
KNOWN_PATH = WORKBENCH_ROOT / "known-rvas.json"
HEX_RVA = re.compile(r"^0x[0-9a-f]+$", re.IGNORECASE)
HEX_TOKEN = re.compile(r"0x[0-9a-f]+", re.IGNORECASE)
INDEX_SCHEMA_VERSION = 1


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def load_config() -> dict[str, Any]:
    return load_json(CONFIG_PATH)


def resolve_relative(relative: str) -> Path:
    return WORKBENCH_ROOT / Path(relative)


def workbench_paths() -> tuple[dict[str, Any], Path, Path]:
    config = load_config()
    image_path = resolve_relative(config["analysisImage"]["relativePath"])
    index_path = resolve_relative(config["index"]["relativePath"])
    return config, image_path, index_path


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest().upper()


def verify_image_spec(
    spec: dict[str, Any], image_path: Path, label: str = "Image"
) -> tuple[str, int]:
    if not image_path.is_file():
        raise SystemExit(
            f"{label} is missing: {image_path}\n"
            "Run: npm run re:d2r32:init -- -ImagePath <decrypted-image>"
        )
    size = image_path.stat().st_size
    expected_size = int(spec["size"])
    if size != expected_size:
        raise SystemExit(
            f"{label} size mismatch: expected={expected_size} actual={size}"
        )
    digest = sha256_file(image_path)
    expected_hash = spec["sha256"].upper()
    if digest != expected_hash:
        raise SystemExit(
            f"{label} SHA-256 mismatch: expected={expected_hash} actual={digest}"
        )
    return digest, size


def parse_number(value: str, image_base: int) -> int:
    number = int(value, 0)
    return number - image_base if number >= image_base else number


def section_bytes(pe: pefile.PE, image: bytes, name: str) -> tuple[int, bytes]:
    for section in pe.sections:
        section_name = section.Name.rstrip(b"\0").decode("ascii", errors="replace")
        if section_name == name:
            start = int(section.PointerToRawData)
            size = int(section.SizeOfRawData)
            return int(section.VirtualAddress), image[start : start + size]
    raise KeyError(f"PE section not found: {name}")


def runtime_functions(pe: pefile.PE, image: bytes) -> list[tuple[int, int, int]]:
    directory = pe.OPTIONAL_HEADER.DATA_DIRECTORY[
        pefile.DIRECTORY_ENTRY["IMAGE_DIRECTORY_ENTRY_EXCEPTION"]
    ]
    start = pe.get_offset_from_rva(int(directory.VirtualAddress))
    size = int(directory.Size)
    result: list[tuple[int, int, int]] = []
    image_size = int(pe.OPTIONAL_HEADER.SizeOfImage)
    for offset in range(start, start + size - 11, 12):
        begin, end, unwind = struct.unpack_from("<III", image, offset)
        if begin == 0 and end == 0 and unwind == 0:
            continue
        if not (0 < begin < end <= image_size):
            continue
        result.append((begin, end, unwind))
    result.sort(key=lambda item: (item[0], item[1]))
    return result


def containing_function(
    functions: list[tuple[int, int, int]], target_rva: int
) -> tuple[int, int, int] | None:
    starts = [item[0] for item in functions]
    index = bisect.bisect_right(starts, target_rva) - 1
    if index >= 0:
        candidate = functions[index]
        if candidate[0] <= target_rva < candidate[1]:
            return candidate
    return None


def file_bytes_at_rva(pe: pefile.PE, image: bytes, start_rva: int, end_rva: int) -> bytes:
    start = pe.get_offset_from_rva(start_rva)
    end = pe.get_offset_from_rva(end_rva - 1) + 1
    return image[start:end]


def load_known() -> list[dict[str, Any]]:
    return load_json(KNOWN_PATH)["entries"]


def known_by_rva() -> dict[int, list[dict[str, Any]]]:
    result: dict[int, list[dict[str, Any]]] = {}
    for entry in load_known():
        result.setdefault(int(entry["rva"], 16), []).append(entry)
    return result


def open_index(index_path: Path) -> sqlite3.Connection:
    if not index_path.is_file():
        raise SystemExit("Index is missing. Run: npm run re:d2r32 -- index")
    connection = sqlite3.connect(index_path)
    connection.row_factory = sqlite3.Row
    return connection


def iter_json_rvas(value: Any, path: str = "$") -> Iterator[tuple[int, str, str]]:
    if isinstance(value, dict):
        context = str(
            value.get("name")
            or value.get("description")
            or value.get("decision")
            or ""
        )
        for key, child in value.items():
            child_path = f"{path}.{key}"
            if isinstance(child, str):
                for token in HEX_TOKEN.findall(child):
                    yield int(token, 16), child_path, context
            else:
                yield from iter_json_rvas(child, child_path)
    elif isinstance(value, list):
        for index, child in enumerate(value):
            yield from iter_json_rvas(child, f"{path}[{index}]")


def extract_strings(data: bytes, base_rva: int) -> Iterator[tuple[int, str, str]]:
    ascii_pattern = re.compile(rb"[\x20-\x7e]{4,}")
    utf16_pattern = re.compile(rb"(?:[\x20-\x7e]\x00){4,}")
    for match in ascii_pattern.finditer(data):
        text = match.group(0)[:512].decode("ascii", errors="replace")
        yield base_rva + match.start(), "ascii", text
    for match in utf16_pattern.finditer(data):
        text = match.group(0)[:1024].decode("utf-16-le", errors="replace")
        yield base_rva + match.start(), "utf16", text


def create_schema(connection: sqlite3.Connection) -> None:
    connection.executescript(
        """
        PRAGMA journal_mode = OFF;
        PRAGMA synchronous = OFF;
        PRAGMA temp_store = MEMORY;
        CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE functions (
            start_rva INTEGER PRIMARY KEY,
            end_rva INTEGER NOT NULL,
            unwind_rva INTEGER NOT NULL,
            size INTEGER NOT NULL
        );
        CREATE TABLE refs (
            source_rva INTEGER NOT NULL,
            target_rva INTEGER NOT NULL,
            kind TEXT NOT NULL,
            function_rva INTEGER NOT NULL
        );
        CREATE INDEX refs_target ON refs(target_rva);
        CREATE INDEX refs_source ON refs(source_rva);
        CREATE TABLE strings (
            rva INTEGER NOT NULL,
            encoding TEXT NOT NULL,
            text TEXT NOT NULL
        );
        CREATE INDEX strings_rva ON strings(rva);
        CREATE TABLE patch_sites (
            rva INTEGER NOT NULL,
            patch_name TEXT NOT NULL,
            description TEXT NOT NULL,
            source TEXT NOT NULL,
            expected TEXT,
            replacement TEXT
        );
        CREATE INDEX patch_sites_rva ON patch_sites(rva);
        CREATE TABLE knowledge (
            rva INTEGER NOT NULL,
            name TEXT NOT NULL,
            kind TEXT NOT NULL,
            confidence TEXT NOT NULL,
            source TEXT NOT NULL,
            notes TEXT NOT NULL
        );
        CREATE INDEX knowledge_rva ON knowledge(rva);
        CREATE TABLE json_refs (
            rva INTEGER NOT NULL,
            source TEXT NOT NULL,
            json_path TEXT NOT NULL,
            context TEXT NOT NULL
        );
        CREATE INDEX json_refs_rva ON json_refs(rva);
        """
    )


def command_index(_: argparse.Namespace) -> int:
    config, image_path, index_path = workbench_paths()
    digest, _ = verify_image_spec(config["analysisImage"], image_path, "Analysis image")
    image = image_path.read_bytes()
    pe = pefile.PE(data=image, fast_load=False)
    functions = runtime_functions(pe, image)
    image_base = int(config["target"]["imageBase"], 16)

    index_path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = index_path.with_suffix(".sqlite.tmp")
    if temp_path.exists():
        temp_path.unlink()
    connection = sqlite3.connect(temp_path)
    try:
        create_schema(connection)
        connection.executemany(
            "INSERT INTO functions VALUES (?, ?, ?, ?)",
            ((start, end, unwind, end - start) for start, end, unwind in functions),
        )

        known = load_known()
        connection.executemany(
            "INSERT INTO knowledge VALUES (?, ?, ?, ?, ?, ?)",
            (
                (
                    int(entry["rva"], 16),
                    entry["name"],
                    entry["kind"],
                    entry["confidence"],
                    entry["source"],
                    entry["notes"],
                )
                for entry in known
            ),
        )

        patch_root = REPO_ROOT / "data-BKVince" / "d2rloader" / "patches"
        patch_rows: list[tuple[Any, ...]] = []
        for patch_path in sorted(patch_root.glob("*.json")):
            document = load_json(patch_path)
            for patch in document.get("patches", []):
                replacement = patch.get("bytes", patch.get("value", ""))
                patch_rows.append(
                    (
                        int(patch["rva"], 16),
                        document.get("name", patch_path.stem),
                        patch.get("description", ""),
                        patch_path.relative_to(REPO_ROOT).as_posix(),
                        patch.get("expected", ""),
                        str(replacement),
                    )
                )
        connection.executemany(
            "INSERT INTO patch_sites VALUES (?, ?, ?, ?, ?, ?)", patch_rows
        )

        json_rows: list[tuple[int, str, str, str]] = []
        for source in sorted((REPO_ROOT / "Mission").glob("*.json")):
            try:
                document = load_json(source)
            except json.JSONDecodeError:
                continue
            relative = source.relative_to(REPO_ROOT).as_posix()
            for rva, json_path, context in iter_json_rvas(document):
                if rva < image_base:
                    json_rows.append((rva, relative, json_path, context[:600]))
        connection.executemany(
            "INSERT INTO json_refs VALUES (?, ?, ?, ?)", json_rows
        )

        for section_name in (".rdata", ".data", ".rodata"):
            try:
                section_rva, data = section_bytes(pe, image, section_name)
            except KeyError:
                continue
            connection.executemany(
                "INSERT INTO strings VALUES (?, ?, ?)",
                extract_strings(data, section_rva),
            )

        md = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
        md.detail = True
        md.skipdata = True
        ref_rows: list[tuple[int, int, str, int]] = []
        text_rva, text = section_bytes(pe, image, ".text")
        text_end = text_rva + len(text)
        for ordinal, (start, end, _) in enumerate(functions, 1):
            if start < text_rva or end > text_end:
                continue
            code = text[start - text_rva : end - text_rva]
            for instruction in md.disasm(code, image_base + start):
                source_rva = instruction.address - image_base
                if instruction.id == 0:
                    continue
                is_flow = instruction.group(capstone.CS_GRP_CALL) or instruction.group(
                    capstone.CS_GRP_JUMP
                )
                for operand in instruction.operands:
                    if is_flow and operand.type == x86_const.X86_OP_IMM:
                        target = int(operand.imm) - image_base
                        if 0 <= target < int(pe.OPTIONAL_HEADER.SizeOfImage):
                            kind = (
                                "call"
                                if instruction.group(capstone.CS_GRP_CALL)
                                else "branch"
                            )
                            ref_rows.append((source_rva, target, kind, start))
                    elif (
                        operand.type == x86_const.X86_OP_MEM
                        and operand.mem.base == x86_const.X86_REG_RIP
                    ):
                        target = (
                            instruction.address
                            + instruction.size
                            + int(operand.mem.disp)
                            - image_base
                        )
                        if 0 <= target < int(pe.OPTIONAL_HEADER.SizeOfImage):
                            ref_rows.append((source_rva, target, "rip", start))
                if len(ref_rows) >= 10000:
                    connection.executemany("INSERT INTO refs VALUES (?, ?, ?, ?)", ref_rows)
                    ref_rows.clear()
            if ordinal % 10000 == 0:
                print(f"indexedFunctions={ordinal}/{len(functions)}")
        if ref_rows:
            connection.executemany("INSERT INTO refs VALUES (?, ?, ?, ?)", ref_rows)

        metadata = {
            "schemaVersion": str(INDEX_SCHEMA_VERSION),
            "imageSha256": digest,
            "build": str(config["target"]["build"]),
            "imageBase": config["target"]["imageBase"],
            "functionCount": str(len(functions)),
        }
        connection.executemany(
            "INSERT INTO metadata VALUES (?, ?)", metadata.items()
        )
        connection.commit()
    finally:
        connection.close()
    os.replace(temp_path, index_path)

    with sqlite3.connect(index_path) as check:
        ref_count = check.execute("SELECT COUNT(*) FROM refs").fetchone()[0]
        string_count = check.execute("SELECT COUNT(*) FROM strings").fetchone()[0]
        patch_count = check.execute("SELECT COUNT(*) FROM patch_sites").fetchone()[0]
    print(f"index={index_path}")
    print(f"functions={len(functions)} refs={ref_count} strings={string_count} patches={patch_count}")
    return 0


def directory_size(path: Path) -> int:
    if not path.exists():
        return 0
    return sum(item.stat().st_size for item in path.rglob("*") if item.is_file())


def command_status(_: argparse.Namespace) -> int:
    config, image_path, index_path = workbench_paths()
    canonical_path = resolve_relative(config["canonicalImage"]["relativePath"])
    canonical_digest, canonical_size = verify_image_spec(
        config["canonicalImage"], canonical_path, "Canonical image"
    )
    digest, size = verify_image_spec(
        config["analysisImage"], image_path, "Analysis image"
    )
    ghidra_root = resolve_relative(config["ghidra"]["projectDirectory"])
    project_file = ghidra_root / f'{config["ghidra"]["projectName"]}.gpr'
    project_rep = ghidra_root / f'{config["ghidra"]["projectName"]}.rep'
    print(f"target=D2R {config['target']['version']} build {config['target']['build']}")
    print(f"canonicalImage={canonical_path}")
    print(
        f"canonicalSize={canonical_size} canonicalSha256={canonical_digest} verified=true"
    )
    print(f"analysisImage={image_path}")
    print(f"analysisSize={size} analysisSha256={digest} verified=true")
    if index_path.is_file():
        with open_index(index_path) as connection:
            metadata = dict(connection.execute("SELECT key, value FROM metadata"))
            counts = {
                table: connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
                for table in ("functions", "refs", "strings", "patch_sites", "knowledge", "json_refs")
            }
        print(
            f"index={index_path} verified={metadata.get('imageSha256') == digest} "
            + " ".join(f"{key}={value}" for key, value in counts.items())
        )
    else:
        print(f"index={index_path} present=false")
    print(
        f"ghidraProject={project_file} present={project_file.is_file()} "
        f"bytes={directory_size(project_rep)}"
    )
    print(f"canonicalReady={image_path.is_file() and index_path.is_file()}")
    return 0


def command_self_test(_: argparse.Namespace) -> int:
    config, image_path, index_path = workbench_paths()
    canonical_path = resolve_relative(config["canonicalImage"]["relativePath"])
    verify_image_spec(config["canonicalImage"], canonical_path, "Canonical image")
    digest, _ = verify_image_spec(
        config["analysisImage"], image_path, "Analysis image"
    )
    image = image_path.read_bytes()
    pe = pefile.PE(data=image, fast_load=False)
    functions = runtime_functions(pe, image)
    expected_functions = int(config["analysisImage"]["runtimeFunctionCount"])
    if len(functions) != expected_functions:
        raise SystemExit(
            f"Runtime function count mismatch: expected={expected_functions} actual={len(functions)}"
        )
    tome_function = containing_function(functions, 0x5817BD)
    if tome_function is None or tome_function[0] != 0x58170C:
        raise SystemExit(f"Unexpected tome function boundary: {tome_function}")
    with open_index(index_path) as connection:
        indexed_hash = connection.execute(
            "SELECT value FROM metadata WHERE key = 'imageSha256'"
        ).fetchone()[0]
        if indexed_hash != digest:
            raise SystemExit(
                f"Index image mismatch: expected={digest} actual={indexed_hash}"
            )
        xref = connection.execute(
            "SELECT 1 FROM refs WHERE source_rva = 0x5817CC AND target_rva = 0x46F090 AND kind = 'call'"
        ).fetchone()
        if xref is None:
            raise SystemExit("Known Book-to-quantity synchronization xref is missing")
        patch = connection.execute(
            "SELECT expected FROM patch_sites WHERE rva = 0x5817BD LIMIT 1"
        ).fetchone()
        if patch is None or patch[0].replace(" ", "").upper() != "41B9FFFFFFFF":
            raise SystemExit("Known infinite-tome patch site is missing or changed")
    print("selfTest=PASS")
    print(f"runtimeFunctions={len(functions)}")
    print("knownXref=0x5817CC->0x46F090")
    print("knownPatchSite=0x5817BD")
    return 0


def annotations_for_rva(
    connection: sqlite3.Connection | None, known: dict[int, list[dict[str, Any]]], rva: int
) -> list[str]:
    labels = [entry["name"] for entry in known.get(rva, [])]
    if connection is not None:
        labels.extend(
            row[0]
            for row in connection.execute(
                "SELECT description FROM patch_sites WHERE rva = ?", (rva,)
            )
        )
        string_row = connection.execute(
            "SELECT text FROM strings WHERE rva = ? LIMIT 1", (rva,)
        ).fetchone()
        if string_row:
            labels.append(repr(string_row[0][:100]))
    return list(dict.fromkeys(label for label in labels if label))


def command_function(args: argparse.Namespace) -> int:
    config, image_path, index_path = workbench_paths()
    verify_image_spec(config["analysisImage"], image_path, "Analysis image")
    image = image_path.read_bytes()
    pe = pefile.PE(data=image, fast_load=False)
    image_base = int(config["target"]["imageBase"], 16)
    target = parse_number(args.rva, image_base)
    functions = runtime_functions(pe, image)
    function = containing_function(functions, target)
    if function is None:
        raise SystemExit(f"No x64 runtime function contains RVA 0x{target:X}")
    start, end, unwind = function
    code = file_bytes_at_rva(pe, image, start, end)
    md = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
    md.detail = True
    md.skipdata = True
    instructions = list(md.disasm(code, image_base + start))
    target_address = image_base + target
    center = min(
        range(len(instructions)),
        key=lambda index: abs(instructions[index].address - target_address),
    )
    lower = max(0, center - args.before)
    upper = min(len(instructions), center + args.after + 1)
    known = known_by_rva()
    connection = open_index(index_path) if index_path.is_file() else None
    try:
        print(
            f"function=0x{start:X}-0x{end:X} size={end-start} unwind=0x{unwind:X} "
            f"target=0x{target:X} instructions={len(instructions)} showing={lower}:{upper}"
        )
        for instruction in instructions[lower:upper]:
            rva = instruction.address - image_base
            marker = ">" if instruction.address <= target_address < instruction.address + instruction.size else " "
            annotation: list[str] = annotations_for_rva(connection, known, rva)
            if instruction.id != 0 and (
                instruction.group(capstone.CS_GRP_CALL)
                or instruction.group(capstone.CS_GRP_JUMP)
            ):
                for operand in instruction.operands:
                    if operand.type == x86_const.X86_OP_IMM:
                        annotation.extend(
                            annotations_for_rva(
                                connection, known, int(operand.imm) - image_base
                            )
                        )
            suffix = f" ; {' | '.join(dict.fromkeys(annotation))}" if annotation else ""
            byte_text = instruction.bytes.hex(" ").upper()
            print(
                f"{marker} 0x{rva:08X}  {byte_text:<38} "
                f"{instruction.mnemonic:<9} {instruction.op_str}{suffix}"
            )
    finally:
        if connection is not None:
            connection.close()
    return 0


def command_xrefs(args: argparse.Namespace) -> int:
    config, _, index_path = workbench_paths()
    image_base = int(config["target"]["imageBase"], 16)
    target = parse_number(args.rva, image_base)
    with open_index(index_path) as connection:
        rows = connection.execute(
            """
            SELECT source_rva, target_rva, kind, function_rva
            FROM refs WHERE target_rva = ?
            ORDER BY source_rva LIMIT ?
            """,
            (target, args.limit),
        ).fetchall()
        print(f"target=0x{target:X} xrefs={len(rows)} limit={args.limit}")
        known = known_by_rva()
        for row in rows:
            labels = annotations_for_rva(connection, known, row["function_rva"])
            suffix = f" {' | '.join(labels)}" if labels else ""
            print(
                f"{row['kind']:<6} source=0x{row['source_rva']:X} "
                f"function=0x{row['function_rva']:X}{suffix}"
            )
    return 0


def command_known(args: argparse.Namespace) -> int:
    _, _, index_path = workbench_paths()
    term = " ".join(args.term).strip()
    if not index_path.is_file():
        entries = load_known()
        matches = [
            entry
            for entry in entries
            if not term
            or term.casefold()
            in " ".join(str(value) for value in entry.values()).casefold()
        ]
        for entry in matches[: args.limit]:
            print(
                f"{entry['rva']} {entry['kind']} {entry['name']} "
                f"[{entry['confidence']}] - {entry['notes']} ({entry['source']})"
            )
        return 0

    like = f"%{term}%"
    with open_index(index_path) as connection:
        rows = connection.execute(
            """
            SELECT printf('0x%X', rva) AS rva, kind AS category, name AS title,
                   confidence AS detail, source, notes AS context
              FROM knowledge
             WHERE ? = '' OR name LIKE ? OR notes LIKE ? OR source LIKE ?
            UNION ALL
            SELECT printf('0x%X', rva), 'patch', description, patch_name, source,
                   COALESCE(expected, '') || ' -> ' || COALESCE(replacement, '')
              FROM patch_sites
             WHERE ? = '' OR description LIKE ? OR patch_name LIKE ? OR source LIKE ?
            UNION ALL
            SELECT printf('0x%X', rva), 'mission', json_path, '', source, context
              FROM json_refs
             WHERE ? = '' OR context LIKE ? OR json_path LIKE ? OR source LIKE ?
            LIMIT ?
            """,
            (
                term,
                like,
                like,
                like,
                term,
                like,
                like,
                like,
                term,
                like,
                like,
                like,
                args.limit,
            ),
        ).fetchall()
        for row in rows:
            context = str(row["context"] or "").replace("\n", " ")[:300]
            print(
                f"{row['rva']} {row['category']} {row['title']} "
                f"[{row['detail']}] - {context} ({row['source']})"
            )
    return 0


def parse_pattern(pattern: str) -> tuple[bytes, bytes]:
    tokens = pattern.replace(",", " ").split()
    if not tokens:
        raise ValueError("Byte pattern is empty")
    values = bytearray()
    masks = bytearray()
    for token in tokens:
        if token in {"?", "??"}:
            values.append(0)
            masks.append(0)
        elif re.fullmatch(r"[0-9a-fA-F]{2}", token):
            values.append(int(token, 16))
            masks.append(0xFF)
        else:
            raise ValueError(f"Invalid byte token: {token}")
    return bytes(values), bytes(masks)


def command_bytes(args: argparse.Namespace) -> int:
    config, image_path, _ = workbench_paths()
    verify_image_spec(config["analysisImage"], image_path, "Analysis image")
    image = image_path.read_bytes()
    pe = pefile.PE(data=image, fast_load=False)
    section_rva, data = section_bytes(pe, image, args.section)
    values, masks = parse_pattern(args.pattern)
    matches: list[int] = []
    width = len(values)
    for offset in range(0, len(data) - width + 1):
        if all(not masks[index] or data[offset + index] == values[index] for index in range(width)):
            matches.append(section_rva + offset)
            if len(matches) >= args.limit:
                break
    print(
        f"section={args.section} pattern={args.pattern!r} "
        f"matches={len(matches)} limit={args.limit}"
    )
    for rva in matches:
        print(f"0x{rva:X}")
    return 0


def command_hydrate(args: argparse.Namespace) -> int:
    config = load_config()
    canonical_path = resolve_relative(config["canonicalImage"]["relativePath"])
    analysis_path = resolve_relative(config["analysisImage"]["relativePath"])
    verify_image_spec(config["canonicalImage"], canonical_path, "Canonical image")

    source_path = Path(args.source).expanduser().resolve()
    if not source_path.is_file():
        raise SystemExit(f"PE metadata source is missing: {source_path}")
    canonical = bytearray(canonical_path.read_bytes())
    source = source_path.read_bytes()
    canonical_pe = pefile.PE(data=bytes(canonical), fast_load=False)
    source_pe = pefile.PE(data=source, fast_load=False)
    source_sections = {
        section.Name.rstrip(b"\0").decode("ascii", errors="replace"): section
        for section in source_pe.sections
    }

    for name, expected_hash in config["analysisImage"]["hydratedSections"].items():
        canonical_section = next(
            section
            for section in canonical_pe.sections
            if section.Name.rstrip(b"\0").decode("ascii", errors="replace") == name
        )
        source_section = source_sections[name]
        if (
            canonical_section.PointerToRawData != source_section.PointerToRawData
            or canonical_section.SizeOfRawData != source_section.SizeOfRawData
        ):
            raise SystemExit(f"Section layout mismatch for {name}")
        start = int(source_section.PointerToRawData)
        end = start + int(source_section.SizeOfRawData)
        actual_hash = hashlib.sha256(source[start:end]).hexdigest().upper()
        if actual_hash != expected_hash.upper():
            raise SystemExit(
                f"Section {name} mismatch: expected={expected_hash} actual={actual_hash}"
            )
        canonical[start:end] = source[start:end]
        print(f"hydrated={name} sha256={actual_hash}")

    analysis_path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = analysis_path.with_suffix(".exe.tmp")
    temp_path.write_bytes(canonical)
    actual_hash = sha256_file(temp_path)
    expected_hash = config["analysisImage"]["sha256"].upper()
    if actual_hash != expected_hash:
        temp_path.unlink(missing_ok=True)
        raise SystemExit(
            f"Derived image mismatch: expected={expected_hash} actual={actual_hash}"
        )
    os.replace(temp_path, analysis_path)
    print(f"analysisImage={analysis_path}")
    print(f"sha256={actual_hash} verified=true")
    return 0


def command_extract_text(_: argparse.Namespace) -> int:
    config, image_path, _ = workbench_paths()
    verify_image_spec(config["analysisImage"], image_path, "Analysis image")
    image = image_path.read_bytes()
    pe = pefile.PE(data=image, fast_load=False)
    text_rva, text = section_bytes(pe, image, ".text")
    expected_base = int(config["ghidra"]["blockBase"], 16)
    image_base = int(config["target"]["imageBase"], 16)
    if image_base + text_rva != expected_base:
        raise SystemExit(
            f"Unexpected .text base: expected=0x{expected_base:X} "
            f"actual=0x{image_base + text_rva:X}"
        )
    digest = hashlib.sha256(text).hexdigest().upper()
    expected_hash = config["ghidra"]["inputSha256"].upper()
    expected_size = int(config["ghidra"]["inputSize"])
    if digest != expected_hash or len(text) != expected_size:
        raise SystemExit(
            f"Unexpected .text artifact: size={len(text)} sha256={digest}"
        )

    text_path = resolve_relative(config["ghidra"]["inputRelativePath"])
    text_path.parent.mkdir(parents=True, exist_ok=True)
    text_temp = text_path.with_suffix(".bin.tmp")
    text_temp.write_bytes(text)
    os.replace(text_temp, text_path)

    function_path = resolve_relative(config["ghidra"]["functionMapRelativePath"])
    function_path.parent.mkdir(parents=True, exist_ok=True)
    function_temp = function_path.with_suffix(".csv.tmp")
    functions = runtime_functions(pe, image)
    with function_temp.open("w", encoding="utf-8", newline="\n") as stream:
        stream.write("start_rva,end_rva,unwind_rva\n")
        for start, end, unwind in functions:
            stream.write(f"0x{start:X},0x{end:X},0x{unwind:X}\n")
    os.replace(function_temp, function_path)
    print(f"textArtifact={text_path}")
    print(f"textBase=0x{expected_base:X} size={len(text)} sha256={digest}")
    print(f"functionMap={function_path} functions={len(functions)}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    status = subparsers.add_parser("status", help="Verify the canonical cache")
    status.set_defaults(handler=command_status)

    self_test = subparsers.add_parser("self-test", help="Validate known analysis invariants")
    self_test.set_defaults(handler=command_self_test)

    index = subparsers.add_parser("index", help="Build or refresh the compact index")
    index.set_defaults(handler=command_index)

    hydrate = subparsers.add_parser(
        "hydrate", help="Build the deterministic analysis image from canonical code"
    )
    hydrate.add_argument("--source", required=True, help="Same-build D2R.exe metadata source")
    hydrate.set_defaults(handler=command_hydrate)

    extract_text = subparsers.add_parser(
        "extract-text", help="Create the raw Ghidra input and x64 function map"
    )
    extract_text.set_defaults(handler=command_extract_text)

    function = subparsers.add_parser("function", help="Disassemble the function containing an RVA")
    function.add_argument("rva")
    function.add_argument("--before", type=int, default=35)
    function.add_argument("--after", type=int, default=90)
    function.set_defaults(handler=command_function)

    xrefs = subparsers.add_parser("xrefs", help="List indexed xrefs to an RVA")
    xrefs.add_argument("rva")
    xrefs.add_argument("--limit", type=int, default=100)
    xrefs.set_defaults(handler=command_xrefs)

    known = subparsers.add_parser("known", help="Search governed names, patches and mission RVAs")
    known.add_argument("term", nargs="*")
    known.add_argument("--limit", type=int, default=80)
    known.set_defaults(handler=command_known)

    byte_search = subparsers.add_parser("bytes", help="Search an exact/wildcard byte pattern")
    byte_search.add_argument("pattern")
    byte_search.add_argument("--section", default=".text")
    byte_search.add_argument("--limit", type=int, default=100)
    byte_search.set_defaults(handler=command_bytes)
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    try:
        return int(args.handler(args))
    except (KeyError, ValueError, sqlite3.Error, pefile.PEFormatError) as exc:
        parser.error(str(exc))
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
