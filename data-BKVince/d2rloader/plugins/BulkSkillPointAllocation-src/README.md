# Bulk Skill Point Allocation

`BulkSkillPointAllocation` is a hybrid D2RLoader plugin for `D2R.exe 3.2.92777`.
It can be installed globally or inside a mod and does not declare `ModScopedOnly`.

- Normal click invests one skill point.
- Ctrl + click invests up to `skill_points_per_ctrl_click` skill points without confirmation.
- Shift + click asks for confirmation, then invests every skill point the active runtime rules allow.
- Shift takes precedence when Ctrl and Shift are held together.

Modifier keys use D2R's native asynchronous key-state path so Ctrl remains
visible when the skill-allocation packet is constructed.

Every additional skill point passes through the native client eligibility check and the
native single-point packet path. The queue waits for the server-confirmed base-level update before
sending the next request, so custom `SkPoints`, prerequisites, attributes, required level,
class restrictions and runtime `MaxLvl` values remain authoritative. No level-20 cap is
compiled into the plugin.

The Shift confirmation is an owned Windows confirmation dialog because D2R 3.2 does not
expose a stable plugin API for constructing an in-game confirmation panel. Cancelling it
sends no allocation request.

Use `bulk-skill-points` in the D2RLoader console to show the active settings, queue state
and diagnostic counters.
