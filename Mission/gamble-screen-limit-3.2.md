# Increased gamble screen item limit — D2RLoader 3.2

## Scope

Increase the number of item-generation attempts used to populate the gambling
screen in `D2R.exe 3.2.92777`, without changing item eligibility, quality rolls,
prices or vendor inventories outside gamble mode.

## Proven native behavior

The persistent workbench was verified before analysis. The canonical decrypted
image and analysis index both match their governed SHA-256 values.

`D2GAME_STORES_FillGamble` begins at RVA `0x541880`. Its successful-generation
counter is incremented at `0x541A4A`, and the loop bound is the unique sequence:

```text
0x541A7C  83 FD 0E                cmp ebp, 0x0E
0x541A7F  0F 8C DB FE FF FF       jl  0x541960
```

The exact nine-byte pattern occurs once in the 92777 `.text` section. It proves
that the vanilla bound is 14 attempts, not approximately 30–32. Item creation or
placement can still fail early, so the number of visible entries may be lower.

D2MOO provides semantic corroboration only:
`D2MOO@19019806df7f3e877fa105b05395d1e3597e2316:source/D2Game/src/UNIT/SUnitNpc.cpp:2423-2575`
implements the legacy `D2GAME_STORES_FillGamble` loop with `nCounter < 14`.
No legacy address, structure or ABI is transferred to D2R 3.2.

## Implementation

`GambleScreenLimit 1.1.0` is a hybrid D2RLoader plugin attributed to
`RuffnecKk`. It can be installed globally or under a mod and does not declare
`ModScopedOnly`.

The plugin validates build 92777 and the complete original nine-byte signature,
then replaces only the immediate bound byte at RVA `0x541A7E`. During its
standalone incubation, configuration is read from `GambleScreenLimit.json`,
first from the active mod and then from the game directory:

```jsonc
{
    "itemLimit": 32
}
```

Accepted values are 14 through 127. The default 32 is deliberately conservative
until the full UI and multiplayer matrix is validated. The plugin changes no TXT
table and installs no inline hook.

Vincent confirmed `items` as the future PluginPack owner on 2026-07-22. The
standalone DLL does not modify, link or redistribute an eezstreet binary. Its
flat JSON object is ready to move under `items.gambleScreenLimit` in the single
`D2RPlugins.json` when the feature is merged into `plugin-items.dll`. The
official PluginPack already owns `D2GAME_STORES_FillGamble` at RVA `0x541880`
but writes a distinct byte range, so the current incubation is composable.

## Artifacts and validation

- source: `data-BKVince/d2rloader/plugins/GambleScreenLimit-src/`;
- Release DLL: `data-BKVince/d2rloader/plugins/GambleScreenLimit.dll`;
- configuration: `data-BKVince/BKVince.mpq/GambleScreenLimit.json`;
- public archive: `addons/GambleScreenLimit/GambleScreenLimit.zip`, containing
  only the DLL and JSON, without README, TOML or sources;
- Release DLL SHA-256: `2F451CEA13C4D6807E27C33602B84D319A0E29FF02F24B85C4F39429FD3442ED`;
- JSON SHA-256: `C161620F6955366A400462A617644EBFB7D9D5D31255685D6F3E2D38ED8B144B`;
- ZIP SHA-256: `0BA0A6C35EC74E886BD421A5DE5690E3E6EEF405CBBFF10F33F4AC5CFE4DF1CA`;
- policy tests: limit parsing and range gates pass;
- workbench byte search: one match at `0x541A7C`.

Cold-start validation passed on 2026-07-22: D2RLoader accepted the v2 manifest,
loaded the mod-scoped plugin, and logged that the bound changed from 14 to 32.
The route to Gheed and the gamble UI was exercised separately; the post-patch
visible-count and purchase matrix remains open.

Vincent confirmed on 2026-07-22 that the configured value 32 is stable in his
initial in-game test. This validates the current default, but it does not yet
establish the maximum safe value. Higher values must be tested against actual
merchant-grid saturation as well as crashes.

The remaining functional matrix covers purchasing first and last entries,
repeated refreshes, mouse/controller, UI scales and resolutions, all gamble
vendors, solo/host/joiner, and absence of invisible entries, truncation,
duplication, crash or desynchronization.

Version 1.1.0 passed both configuration paths in cold starts: mod-local JSON and
global fallback JSON. With all five eezstreet PluginPack DLLs present,
`GambleScreenLimit.dll` and `plugin-items.dll` loaded together with
`rejected=0` and `failed=0`; the final runtime state uses the mod-local JSON.
