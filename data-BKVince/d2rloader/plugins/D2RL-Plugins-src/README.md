# D2RL-Plugins

A collection of gameplay plugins for Diablo II: Resurrected, built on top of [D2RLoader](https://discord.gg/fv9mchnAVn). Each plugin is a DLL that hooks into the game executable to extend or modify behavior without replacing any game files.

## Requirements

- **D2RLoader** must be installed and running. These plugins are loaded by D2RLoader and cannot function without it.
- **MSVC 2022** (Visual Studio 2022) or later is required to compile the project.

## Building

Open the project with CMake (the root `CMakeLists.txt`) and build with the MSVC toolchain. The output is a set of `.dll` files, one per plugin.

## Installation

1. Build the project (or obtain pre-built DLLs).
2. Copy all plugin DLLs into the `/plugins` folder. This folder lives in one of two places depending on your setup:
   - The Diablo II: Resurrected install directory (e.g. `C:\Program Files (x86)\Diablo II Resurrected\plugins\`)
   - Your mod's `.mpq` folder (e.g. `<mod>/<mod.mpq>/plugins/`)
3. **`plugin-shared.dll` is required** and must be present in the `/plugins` folder for any of the other plugins to work. It provides shared utilities used by all plugins at runtime.
4. Open `PluginPack.sample.ini` and copy the sections and keys you want to enable into your `D2RLoader.ini`. All features are optional and disabled by default — nothing takes effect until you explicitly enable it in the ini.

## Plugins

| DLL | INI Section | Description |
|-----|-------------|-------------|
| `plugin-shared.dll` | *(none)* | Shared runtime library — required by all plugins |
| `plugin-items.dll` | `[PluginPack.Items]` | Item spawn flags, gold limits, runeword quality unlock, gamble filter, vendor overhaul, resist caps, TreasureClass condition improvements |
| `plugin-levels.dll` | `[PluginPack.Levels]` | Level/area tweaks (e.g. disabling the Act 1 dirt path overlay) |
| `plugin-misc.dll` | `[PluginPack.Misc]` | Miscellaneous tweaks (e.g. `/players` command limit) |
| `plugin-quests.dll` | `[PluginPack.Quests]` | Quest reward overrides — skill/stat point counts, ring and rune rewards, per-difficulty variants |
| `plugin-skills.dll` | `[PluginPack.Skills]` | Skill mana system extensions — life/stamina costs, classic Whirlwind, CtC on WW, Telekinesis pickup, charged item drain chance, Param1/Param2-driven self-heal (heal-to/heal-by, life/mana) |

## Configuration

`PluginPack.sample.ini` contains every available option with its default value, commented out, with descriptions. Copy the keys you want into the `D2RLoader.ini` under the matching section header.

Example snippet:

```ini
[PluginPack.Items]
DisableGoldPenalty=1
EnableInventoryGoldLimitChange=1
InventoryGoldLimit=25000

[PluginPack.Skills]
EnableClassicWW=1
```


## License

MIT
