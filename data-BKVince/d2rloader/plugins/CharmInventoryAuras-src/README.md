# Charm Inventory Auras

Ports @Celestialray's D2R 2.4 `Charm Aura Zone Transition Fix` to D2R
3.2.92777 as a build-gated D2RLoader native plugin.

Version 1.6.0 is hybrid: the same DLL can be installed either globally in
`d2rloader/plugins` or locally in a mod's `d2rloader/plugins` folder.

After the vanilla act/zone transition routine runs, the plugin re-registers the
stat lists of up to 32 identified charms in the player's main inventory that
actually contain `item_aura`. Before refreshing aura charms, it captures both
active skill slots as `(skillId, ownerGuid)` pairs and restores them against the
new skill instances, preserving selected oskills even when the same charm also
carries an aura. Cube, stash, equipped, and unidentified items retain vanilla
transition behavior.

After a successful player-corpse recovery, version 1.5.0 instead invokes D2R's
native full player-item refresh. That routine snapshots player vitals and active
skills, expires each owned inventory item stat list, merges it again, then
restores the snapshot. This reproduces the missing detach/re-attach semantics
that manually picking up and replacing the charm provided. A failed corpse
interaction does not trigger the refresh.

Version 1.6.0 invokes the same native full item refresh immediately after the
softcore resurrection path has returned the player to town. The hook is
filtered to that single call site, after the town-neutral mode is finalized;
the earlier hardcore disconnect path cannot reach it.

The console command `charm-inventory-auras` reports transition, corpse-recovery,
town-respawn, scan, refresh, and safety-guard counters.

Build and test:

```powershell
cmake -S . -B build -A x64
cmake --build build --config Release
ctest --test-dir build -C Release --output-on-failure
```
