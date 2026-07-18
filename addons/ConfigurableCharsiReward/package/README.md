# Configurable Charsi Reward 2.1

Standalone D2RLoader add-on for **Diablo II: Resurrected 3.2.92777**.

Killing one configured target grants each player in the game **1, 2, or 3 additional native Charsi Imbue rewards** in the current difficulty. The target can be either a traditional superunique or a boss from `monstats.txt`, including an Act boss, Uber, or mini-Uber.

No item is dropped or required. Return to Charsi and use her normal **Imbue** interface. The bonus is added on top of the normal **Tools of the Trade** quest reward; it does not replace, complete, or consume the original quest reward.

## Requirements

- Diablo II: Resurrected build `3.2.92777`
- D2RLoader with Plugin API v2 support
- D2RLoader installed in the Diablo II: Resurrected game folder

The add-on is signature-locked to the supported game build. It refuses to install its hooks if the executable does not match.

## Files included

- `ConfigurableCharsiReward.dll` - the D2RLoader plugin
- `configurable-charsi-reward.toml` - the user configuration
- `README.md` - this installation and usage guide

## Installation

1. Close Diablo II: Resurrected and D2RLoader.
2. Extract the ZIP archive.
3. Copy `ConfigurableCharsiReward.dll` to:

   ```text
   <Diablo II Resurrected>\d2rloader\plugins\
   ```

4. Copy `configurable-charsi-reward.toml` to:

   ```text
   <Diablo II Resurrected>\d2rloader\config\
   ```

5. Create the `plugins` or `config` folder if it does not already exist.
6. Edit the copied TOML file before starting the game.

Do not copy these files into a mod data folder. This is a global D2RLoader add-on, not part of BKVince, TCP, or another `-mod` package.

## Configuration

Only one target can be active at a time. Open `d2rloader\config\configurable-charsi-reward.toml` in a text editor and choose one of the following modes.

### Traditional superunique

Use the exact `Superunique` value from the active `data/global/excel/superuniques.txt`:

```toml
[reward]
enabled = true
target_type = "superunique"
target = "Bishibosh"
reward_count = 3
```

Other examples include `Griswold` and `Pindleskin`.

### Act boss, Uber, or mini-Uber

Use the exact `Id` value of a row marked `boss = 1` in the active `data/global/excel/monstats.txt`:

```toml
[reward]
enabled = true
target_type = "boss"
target = "andariel"
reward_count = 3
```

Common vanilla boss IDs:

| Encounter | `target` value |
|---|---|
| Andariel | `andariel` |
| Duriel | `duriel` |
| Mephisto | `mephisto` |
| Diablo | `diablo` |
| Baal | `baalcrab` |
| Diablo Clone | `diabloclone` |
| Uber Mephisto | `ubermephisto` |
| Pandemonium Diablo | `uberdiablo` |
| Uber Baal | `uberbaal` |
| Lilith | `uberandariel` |
| Uber Duriel | `uberduriel` |
| Uber Izual | `uberizual` |

The plugin resolves this text ID from the active table at startup. Custom bosses are supported when their `monstats.txt` row has `boss = 1`.

### Reward and difficulty settings

```toml
[reward]
reward_count = 3

[difficulties]
normal = true
nightmare = true
hell = true

[diagnostics]
enabled = false
```

- `reward_count`: accepted values are `1`, `2`, or `3`.
- `normal`, `nightmare`, `hell`: enable or disable the reward independently for each difficulty.
- `diagnostics`: set to `true` only when detailed troubleshooting logs are needed.

Pending bonus rewards are capped at three per character and difficulty:

- `reward_count = 1`: three kills grant `1 -> 2 -> 3` pending Imbues.
- `reward_count = 2`: the first kill grants 2; the second raises the total to 3.
- `reward_count = 3`: the first kill immediately fills the reward queue.

Restart the game after changing the configuration.

Existing 2.0 configurations using `superunique = "Bishibosh"` remain supported, but the new `target_type` and `target` keys are recommended.

## First test

1. Start Diablo II: Resurrected through D2RLoader.
2. Confirm that the log reports `ConfigurableCharsiReward 2.1 active` and shows the selected target.
3. Enter a game in an enabled difficulty.
4. Kill the configured target.
5. Talk to Charsi and use her normal **Imbue** option.

No Horadric Malus, token, consumable, Cube ingredient, or special drop should appear. The reward is granted directly through the native quest service.

## Reward behaviour

- Normal, Nightmare, and Hell maintain separate persistent bonus queues.
- Repeated kills add rewards up to a maximum of three pending bonus Imbues per character and difficulty.
- A successful Imbue consumes exactly one available reward.
- The normal Tools of the Trade reward and the bonus rewards are both preserved.
- Killing the target before completing Tools of the Trade does not complete or consume the future normal quest reward.
- In multiplayer, every player present in the game when the configured target dies receives the configured reward count.
- The selected target's ordinary treasure drop is unchanged.

## Troubleshooting

- **The add-on is loaded but inactive:** verify that `enabled = true`, that `target` is not empty, and that the TOML file is in `d2rloader\config\`.
- **The target is rejected:** verify `target_type`. A superunique uses the `Superunique` column; a boss uses the case-sensitive `Id` column and must have `boss = 1`.
- **The kill does nothing:** check the exact spelling and capitalization of `target`, then restart the game.
- **A signature or hook error appears:** verify the D2R build. Another plugin or memory patch may also be modifying the same code.
- **Rewards do not behave as a finite 1-3 queue:** disable any `Infinite Charsi Imbue` patch. It conflicts with this add-on's finite native reward consumption.
- **More detail is needed:** set `[diagnostics] enabled = true`, restart the game, reproduce the issue, and inspect the D2RLoader logs.

As with any gameplay plugin, back up important offline characters before the first test.

## Compatibility

Do not combine this add-on with another plugin or memory patch that hooks the Charsi reward helper, the Charsi quest-state setter, or the treasure-class drop entry point.

The add-on does not modify BKVince/TCP files and does not require a special item drop.

## Uninstallation

1. Spend any pending bonus rewards if you want to use them.
2. Close Diablo II: Resurrected and D2RLoader.
3. Remove:

   ```text
   <Diablo II Resurrected>\d2rloader\plugins\ConfigurableCharsiReward.dll
   <Diablo II Resurrected>\d2rloader\config\configurable-charsi-reward.toml
   ```

Removing the add-on does not delete characters or items. Pending bonus counters remain in the character's quest record but are only interpreted while this DLL is installed.
