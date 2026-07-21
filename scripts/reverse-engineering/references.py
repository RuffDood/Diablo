#!/usr/bin/env python3
"""Manage pinned local source references used by the reverse-engineering workbench."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[2]
MANIFEST_PATH = REPO_ROOT / "reverse-engineering" / "references.json"


def load_manifest() -> dict[str, Any]:
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    if manifest.get("schemaVersion") != 1:
        raise ValueError("Unsupported external-reference manifest schema")
    return manifest


def save_manifest(manifest: dict[str, Any]) -> None:
    MANIFEST_PATH.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
        newline="\n",
    )


def get_reference(reference_id: str) -> tuple[dict[str, Any], dict[str, Any]]:
    manifest = load_manifest()
    for reference in manifest["references"]:
        if reference["id"].casefold() == reference_id.casefold():
            return manifest, reference
    known = ", ".join(item["id"] for item in manifest["references"])
    raise ValueError(f"Unknown reference {reference_id!r}; available: {known}")


def reference_path(reference: dict[str, Any]) -> Path:
    path = (REPO_ROOT / reference["localPath"]).resolve()
    cache_root = (REPO_ROOT / "analysis-cache" / "references").resolve()
    if path != cache_root and cache_root not in path.parents:
        raise ValueError(f"Reference path must stay under {cache_root}: {path}")
    return path


def run(
    command: list[str],
    *,
    cwd: Path | None = None,
    capture: bool = False,
    check: bool = True,
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        command,
        cwd=cwd,
        check=check,
        text=True,
        encoding="utf-8",
        errors="replace",
        capture_output=capture,
    )


def git_output(path: Path, *arguments: str) -> str:
    return run(["git", *arguments], cwd=path, capture=True).stdout.strip()


def ensure_checkout(reference: dict[str, Any]) -> Path:
    path = reference_path(reference)
    if not (path / ".git").is_dir():
        raise ValueError(
            f"Reference checkout is missing: {path}\n"
            f"Run: npm run ref:{reference['id']} -- bootstrap"
        )
    return path


def checkout_is_clean(path: Path) -> bool:
    return not git_output(path, "status", "--porcelain")


def normalized_repository_url(value: str) -> str:
    return value.rstrip("/").removesuffix(".git").casefold()


def command_list(_: argparse.Namespace) -> int:
    manifest = load_manifest()
    for reference in manifest["references"]:
        path = reference_path(reference)
        state = "present" if (path / ".git").is_dir() else "missing"
        print(
            f"{reference['id']}: {reference['name']} {reference['upstreamTarget']} "
            f"commit={reference['commit'][:12]} state={state} path={path}"
        )
    return 0


def command_status(args: argparse.Namespace) -> int:
    _, reference = get_reference(args.reference)
    path = ensure_checkout(reference)
    current = git_output(path, "rev-parse", "HEAD")
    pinned = reference["commit"]
    clean = checkout_is_clean(path)
    shallow = git_output(path, "rev-parse", "--is-shallow-repository")
    remote = git_output(path, "remote", "get-url", "origin")
    remote_verified = normalized_repository_url(remote) == normalized_repository_url(
        reference["repository"]
    )
    license_present = (path / reference["licensePath"]).is_file()
    verified = (
        current.casefold() == pinned.casefold()
        and clean
        and remote_verified
        and license_present
    )
    print(f"reference={reference['id']} name={reference['name']}")
    print(f"path={path}")
    print(f"remote={remote} verified={str(remote_verified).lower()}")
    print(f"branch={reference['branch']} shallow={shallow}")
    print(f"current={current}")
    print(f"pinned={pinned}")
    print(
        f"clean={str(clean).lower()} license={reference['license']} "
        f"licensePresent={str(license_present).lower()} verified={str(verified).lower()}"
    )
    print(f"policy={reference['role']} upstreamTarget={reference['upstreamTarget']}")
    return 0 if verified else 1


def command_bootstrap(args: argparse.Namespace) -> int:
    _, reference = get_reference(args.reference)
    path = reference_path(reference)
    pinned = reference["commit"]
    if (path / ".git").is_dir():
        current = git_output(path, "rev-parse", "HEAD")
        if current.casefold() == pinned.casefold() and checkout_is_clean(path):
            print(f"already-present={path} commit={current}")
            return command_status(args)
        if not checkout_is_clean(path):
            raise ValueError(f"Reference checkout has local changes: {path}")
    elif path.exists():
        raise ValueError(f"Reference path exists but is not a Git checkout: {path}")
    else:
        path.parent.mkdir(parents=True, exist_ok=True)
        run(
            [
                "git",
                "clone",
                "--no-checkout",
                "--filter=blob:none",
                reference["repository"],
                str(path),
            ]
        )
    run(["git", "fetch", "--depth", "1", "origin", pinned], cwd=path)
    run(["git", "checkout", "--detach", pinned], cwd=path)
    return command_status(args)


def search(reference: dict[str, Any], term: str, limit: int, word: bool) -> int:
    path = ensure_checkout(reference)
    rg = shutil.which("rg")
    if rg is None:
        raise ValueError("ripgrep (rg) is required for reference searches")
    command = [rg, "-n", "--no-heading", "--color", "never", "-F"]
    if word:
        command.append("-w")
    command.extend([term, "."])
    result = run(command, cwd=path, capture=True, check=False)
    if result.returncode not in (0, 1):
        raise ValueError(result.stderr.strip() or "ripgrep search failed")
    lines = result.stdout.splitlines()
    commit = reference["commit"]
    print(
        f"reference={reference['id']} commit={commit} query={term!r} "
        f"matches={len(lines)} showing={min(len(lines), limit)}"
    )
    for line in lines[:limit]:
        match = re.match(r"^\.?[\\/]*(.*?):(\d+):(.*)$", line)
        if match:
            relative, line_number, text = match.groups()
            relative = relative.replace("\\", "/")
            print(
                f"{reference['name']}@{commit}:{relative}:{line_number} | "
                f"{text.strip()}"
            )
        else:
            print(line)
    return 0 if lines else 1


def command_search(args: argparse.Namespace) -> int:
    _, reference = get_reference(args.reference)
    return search(reference, " ".join(args.term), args.limit, word=False)


def command_symbol(args: argparse.Namespace) -> int:
    _, reference = get_reference(args.reference)
    return search(reference, args.symbol, args.limit, word=True)


def command_update(args: argparse.Namespace) -> int:
    manifest, reference = get_reference(args.reference)
    path = ensure_checkout(reference)
    if not checkout_is_clean(path):
        raise ValueError(f"Reference checkout has local changes: {path}")
    run(["git", "fetch", "origin", reference["branch"]], cwd=path)
    latest = git_output(path, "rev-parse", "FETCH_HEAD")
    previous = reference["commit"]
    if latest.casefold() == previous.casefold():
        print(f"already-current={latest}")
        return 0
    run(["git", "checkout", "--detach", latest], cwd=path)
    reference["commit"] = latest
    reference["pinnedAt"] = dt.date.today().isoformat()
    save_manifest(manifest)
    print(f"updated={reference['id']} previous={previous} current={latest}")
    print(f"manifest={MANIFEST_PATH}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    listing = subparsers.add_parser("list", help="List governed references")
    listing.set_defaults(handler=command_list)

    for command_name, help_text, handler in (
        ("status", "Verify a pinned local checkout", command_status),
        ("bootstrap", "Clone and checkout the pinned commit", command_bootstrap),
        ("search", "Search text and emit stable citations", command_search),
        ("symbol", "Search an exact source symbol", command_symbol),
        ("update", "Explicitly advance the pin to the upstream branch", command_update),
    ):
        command_parser = subparsers.add_parser(command_name, help=help_text)
        command_parser.add_argument("reference")
        if command_name == "search":
            command_parser.add_argument("term", nargs="+")
            command_parser.add_argument("--limit", type=int, default=80)
        elif command_name == "symbol":
            command_parser.add_argument("symbol")
            command_parser.add_argument("--limit", type=int, default=80)
        command_parser.set_defaults(handler=handler)
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    try:
        return int(args.handler(args))
    except (OSError, ValueError, subprocess.CalledProcessError) as exc:
        parser.error(str(exc))
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
