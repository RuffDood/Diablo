# PotionAutoPickup

Hybrid D2RLoader plugin source for BKVince. It can be installed globally or in
a mod plugin folder. The native adapter targets `D2R.exe 3.2.92777`, scans
server-side ground items, and invokes the same server pickup routine used by
vanilla automatic gold pickup.

The runtime signature is checked by D2RLoader before the hook is installed. Pickup distance is capped at the vanilla gold value of `4`; collision and ground-mode checks are performed before pickup. Healing (`hp1`-`hp5`), mana (`mp1`-`mp5`) and rejuvenation (`rvs`/`rvl`) tiers are read from `PotionAutoPickup.toml`.

Build and policy tests:

```powershell
cmake -S . -B build -A x64
cmake --build build --config Release
ctest --test-dir build -C Release --output-on-failure
```
