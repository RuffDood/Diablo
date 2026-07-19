# EnhancedDamageMinMaxFix

Mod-local D2RLoader plugin for BKVince on D2R 3.2.92777.

Diablo II represents `dmg%` as two stats: `item_mindamage_percent` (18) and
`item_maxdamage_percent` (17). Both use ItemStatCost operation 13. When an item
also has flat damage on the matching side, that operation consumes the percent
locally and omits it from the full stat list propagated to the owner. That is
correct for weapons, but causes the historical ED/Min-Max jewel bug on armor,
helms, and shields.

The plugin hooks `STATLIST_UnitGetStatValue` at RVA `0x002F5C60`. Only layer-zero
reads of stats 17 and 18 on players or monsters are considered. For each active
nonweapon item, the plugin compares the raw percent on the host and its socket
fillers with the percent that D2R actually propagated. Only a positive missing
delta is restored. Weapon item type 45 is explicitly excluded, so weapon-local
Enhanced Damage retains vanilla behavior.

The hook uses a build gate and a strict 15-byte prologue signature. No TXT table
is modified. The `enhanced-damage-min-max-fix` console command reports corrected
reads, restored ED points, scanned equipment/socket items, and traversal guards.

The RVA and ABI evidence is governed by
`Mission/ed-min-max-jewel-fix-3.2.md` and the persistent 92777 workbench.
