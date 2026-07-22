# Bulk Skill Point Allocation

`BulkSkillPointAllocation` is a hybrid D2RLoader plugin for `D2R.exe 3.2.92777`.
It can be installed globally or inside a mod and does not declare `ModScopedOnly`.

- Normal click invests one skill point.
- Ctrl + click invests up to `skillPointsPerCtrlClick` skill points without confirmation.
- Shift + click asks for confirmation, then invests every skill point the active runtime rules allow.
- Shift takes precedence when Ctrl and Shift are held together.

Shift uses D2R's native packet marker. Ctrl checks the generic, left and right
Control keys through both D2R's signed asynchronous key-state wrapper and
Win32 when the skill-allocation packet is constructed.

Every additional skill point passes through the native client eligibility check and the
native single-point packet path. The queue waits for the server-confirmed base-level update before
sending the next request, so custom `SkPoints`, prerequisites, attributes, required level,
class restrictions and runtime `MaxLvl` values remain authoritative. No level-20 cap is
compiled into the plugin. Queue polling and subsequent sends run through a timer attached
to the D2R window, on the same client thread as the original skill click. A strict
in-flight guard and batch generation prevent timer re-entry from duplicating requests.
Each subsequent rank waits for both the exact `+1` skill-level acknowledgement
and a decrease in the native unspent-skill-points stat. Once both are visible,
the next validation and request run on the following 20 ms timer tick.

The Shift confirmation is an owned Windows confirmation dialog because D2R 3.2 does not
expose a stable plugin API for constructing an in-game confirmation panel. Cancelling it
sends no allocation request.

Use `bulk-skill-points` in the D2RLoader console to show the active settings,
queue state, last modifier mask, packet extra value and diagnostic counters.

## Configuration

The plugin reads `BulkSkillPointAllocation.json` from the active mod directory,
then falls back to the game directory. The root object is intentionally flat
because this file configures only one plugin:

```jsonc
{
    // Ctrl + click invests up to this many points without confirmation.
    // Accepted range: 1 through 1000.
    "skillPointsPerCtrlClick": 5,

    // Emit queue diagnostics in the D2RLoader log.
    "diagnostics": false
}
```

If the file is absent, these defaults are used. A malformed file is rejected
instead of silently installing native hooks with unexpected settings.

## PluginPack compatibility

Version 1.1.0 was audited against eezstreet D2RL-Plugins 2.0.1 at commit
`dc75b49ffbb67b887d7757ee00ee9a03bcde5d8a`. Bulk Skill Point Allocation owns
only the allocation-packet builder hook at D2R RVA `0x000EC700`; none of the
five PluginPack modules writes that site or the read-only acknowledgement entry
at `0x002F48C0`. Runtime byte and ABI checks remain strict, so an unknown
overlapping hook makes the plugin refuse to load safely.

The standalone DLL does not link to, modify or redistribute any PluginPack DLL.
If the feature is accepted upstream later, this flat configuration object can
be moved under `items.bulkSkillAllocation` and the implementation compiled into
`plugin-items`.
