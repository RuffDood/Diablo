"""Import bridge for the hyphenated locate-memory-edits.py helper."""

from __future__ import annotations

import importlib.util
from pathlib import Path
import sys


_SOURCE = Path(__file__).with_name("locate-memory-edits.py")
_SPEC = importlib.util.spec_from_file_location("locate_memory_edits", _SOURCE)
if _SPEC is None or _SPEC.loader is None:
    raise RuntimeError(f"Unable to load {_SOURCE}")
_MODULE = importlib.util.module_from_spec(_SPEC)
sys.modules[_SPEC.name] = _MODULE
_SPEC.loader.exec_module(_MODULE)

IMAGE_BASE = _MODULE.IMAGE_BASE
Instruction = _MODULE.Instruction
REGISTER_REPLACEMENTS = _MODULE.REGISTER_REPLACEMENTS
disassemble = _MODULE.disassemble
exception_ranges = _MODULE.exception_ranges
find_containing_range = _MODULE.find_containing_range
iter_code_segments = _MODULE.iter_code_segments
load_pending_sites = _MODULE.load_pending_sites
