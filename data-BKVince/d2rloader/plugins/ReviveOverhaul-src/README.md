# ReviveOverhaul

Hybrid D2RLoader plugin for `D2R.exe 3.2.92777`. It can be installed in the
global D2RLoader plugin directory or in a mod plugin directory.

Install `ReviveOverhaul.dll` in the chosen `d2rloader/plugins/` directory and
install `ReviveOverhaul.toml` in the matching `d2rloader/config/` directory.
The DLL deliberately has no `ModScopedOnly` flag, so the same binary is valid
in either scope.

The plugin changes only the owner-leash path of units whose AI control reports
`AISPECIALSTATE_REVIVED` (`7`). It suppresses the obsolete owner-collision
scatter, starts native catch-up movement sooner, and reduces the native follow
distance. Native monster combat AI remains intact.

## How the AI settings work together

- `catch_up_distance` decides how far a Revive may fall behind before it starts
  hurrying back. Lower values start catch-up sooner; higher values tolerate a
  larger gap. The vanilla value is `20`.
- `follow_distance` decides how close the Revive tries to remain once it moves
  back toward its owner. Lower values produce a tighter group; higher values
  make Revives stop farther away. The vanilla value is `19`, and this value is
  kept below `catch_up_distance` so normal following and catch-up do not fight
  each other.
- `velocity_bonus` is the extra movement speed used only while a Revive is
  catching up. Higher values make catch-up faster; lower values make it slower;
  `0` removes the bonus. The vanilla value is `40`.
- `disable_owner_scatter` stops Revives from stepping away merely because they
  are standing very close to their owner.

Permanent duration is data-driven: the BKVince `Revive` row has an empty
`calc2`, so the native Revive path does not schedule the expiration modifier.
This plugin does not intercept death or pet-limit behavior.

Build and test:

```powershell
cmake -S . -B build -A x64
cmake --build build --config Release
ctest --test-dir build -C Release --output-on-failure
```
