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

D2R's native five-byte `0x3B` request encodes the number of additional ranks in
its final word: `0` means one total point, `4` means five total points, and
`0xFFFF` means every point the runtime allows. Ctrl therefore sends exactly one
packet with `skillPointsPerCtrlClick - 1`; Shift sends exactly one packet with
`0xFFFF`. The authoritative game-side handler still enforces available points,
custom `SkPoints`, prerequisites, attributes, required level, class restrictions
and runtime `MaxLvl`. The plugin contains no rank loop, timer, packet burst or
hard-coded level-20 cap.

Shift opens Diablo's native `ConfirmationModal` asynchronously. The plugin reuses the
signed stat-allocation modal builder, substitutes only the prompt while that modal is
being created, and recognizes its private callback marker at the UI dispatcher. The
game keeps rendering while the modal is open. `Yes` sends the single native
assign-all request; `No` sends no allocation request.

Use `bulk-skill-points` in the D2RLoader console to show the active settings,
last modifier mask, incoming/outgoing packet values and diagnostic counters.

## Configuration

The plugin reads `BulkSkillPointAllocation.json` from the active mod directory,
then falls back to the game directory. The root object is intentionally flat
because this file configures only one plugin:

```jsonc
{
    // Ctrl + click invests up to this many points without confirmation.
    // Accepted range: 1 through 1000.
    "skillPointsPerCtrlClick": 5,

    // Emit native bulk diagnostics in the D2RLoader log.
    "diagnostics": false
}
```

If the file is absent, these defaults are used. A malformed file is rejected
instead of silently installing native hooks with unexpected settings.

The prompt is resolved through Diablo's active-language database. The localization
key and English fallback are stored separately in
`BulkSkillPointAllocation.strings.json`:

```jsonc
{
    // Read this key from the active mod's data/local/lng/strings/ui.json.
    "shiftConfirmationKey": "shiftConfirmation",

    // Used only when the localization key is missing or unresolved.
    "shiftConfirmationFallback": "Invest all currently usable skill points in this skill?"
}
```

This strings file follows the same active-mod-first, game-directory-second lookup.
Add an unused numeric `id`, the key `shiftConfirmation`, and each desired locale to
the active mod's `<mod>.mpq/data/local/lng/strings/ui.json`. For example:

```jsonc
{
    "id": 31188,
    "Key": "shiftConfirmation",
    "enUS": "Invest all currently usable skill points in this skill?",
    "koKR": "이 스킬에 현재 사용할 수 있는 모든 스킬 포인트를 투자하시겠습니까?"
}
```

The numeric ID above is only an example and must be replaced if it is already used
by that mod. Diablo selects the matching locale automatically. The English fallback
is used only when the key cannot be resolved. The `Yes` and `No` labels remain
Diablo's own localized strings.

## PluginPack compatibility

Version 1.2.2 was audited against the latest eezstreet D2RL-Plugins 2.0.1 commit
`dc75b49ffbb67b887d7757ee00ee9a03bcde5d8a`. Bulk Skill Point Allocation owns
the allocation-packet builder hook at D2R RVA `0x000EC700`, the localized-key
resolver hook at `0x005F4B90`, and the UI dispatcher hook at `0x00843D90`.
It calls the native stat confirmation builder at `0x014EF670` without patching
that entry. None of the five PluginPack modules writes these sites. Runtime byte
and ABI checks remain
strict, so an unknown overlapping hook makes the plugin refuse to load safely.

The standalone DLL does not link to, modify or redistribute any PluginPack DLL.
If the feature is accepted upstream later, this flat configuration object can
be moved into `D2RPlugins.json` and the implementation compiled into
`plugin-misc`.
