# EnhancedDamageMinMaxFix

Hybrid global/mod-local D2RLoader plugin for D2R 3.2.92777.

Diablo II represents off-weapon `dmg%` with two statistics:
`item_maxdamage_percent` (17) and `item_mindamage_percent` (18). Both use
ItemStatCost operation 13. When matching flat maximum or minimum damage is
present, the engine evaluates the combined value but deliberately suppresses
the update while the stat list owner type is an item. That behavior is needed
for weapon-local damage, but it causes the historical ED/Min-Max jewel bug on
armor, helms, and shields.

Version `1.2.0` hooks the proven evaluate-and-update routine at
`D2R.exe+0x002FA430`. It leaves the original recursive evaluator intact. After
the original function returns, the plugin restores only an update that meets
all of these conditions:

- ItemStatCost operation is 13;
- packed layer is zero and the stat is 17 or 18;
- the stat-list owner type is an item;
- the effective host item is not a weapon;
- the value retained in the full-stat array differs from the value the engine
  just evaluated.

Weapons keep the vanilla suppression path. The plugin does not scan player
inventories, does not alter TXT data, and does not modify unrelated op=13
statistics. The `enhanced-damage-min-max-fix` console command reports repair
counters and post-write verification failures. The first successful repair is
also written to the D2RLoader log.

External in-game validation completed on July 20, 2026. The repaired damage
path was confirmed with both melee weapons and throwable weapons.

The RVA and ABI evidence is governed by
`Mission/ed-min-max-jewel-fix-3.2.md` and the persistent 92777 workbench.
