"""Import bridge for the hyphenated match-memory-edit-functions.py helper."""

from __future__ import annotations

import importlib.util
from pathlib import Path
import sys


_SOURCE = Path(__file__).with_name("match-memory-edit-functions.py")
_SPEC = importlib.util.spec_from_file_location("match_memory_edit_functions", _SOURCE)
if _SPEC is None or _SPEC.loader is None:
    raise RuntimeError(f"Unable to load {_SOURCE}")
_MODULE = importlib.util.module_from_spec(_SPEC)
sys.modules[_SPEC.name] = _MODULE
_SPEC.loader.exec_module(_MODULE)

FunctionIndex = _MODULE.FunctionIndex
TargetFunction = _MODULE.TargetFunction
load_target_functions = _MODULE.load_target_functions
strict_token = _MODULE.strict_token
