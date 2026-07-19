# DurabilityResistance

Mod-local D2RLoader plugin for BKVince on D2R 3.2.92777.

It hooks the native durability update routine at RVA `0x00441B10`. A separate
resistance percentage can suppress otherwise eligible durability checks for
normal and ethereal equipment. The vanilla 4% weapon and 10% armor chances are
preserved as the base probabilities, and each successful native check still
removes exactly one durability point.

Projectile quantity is handled by a separate native path and remains outside
this hook's policy. When a throwing weapon is used in melee, its internal
durability does pass through this hook, so the configured resistance applies
before depleted durability can reduce the stack by one.

The optional ethereal maximum setting is applied only to the base-stat read
returning at RVA `0x0044351F`, immediately before D2R's native
`(maximum / 2) + 1` calculation. Other stat reads are returned unchanged.
Percentages from 1 through 200 are supported. Values below 100 preserve the
vanilla-style `+1`. The independent `force_maximum_durability` override gives
every newly generated ethereal item D2R's absolute maximum of 255 points.

Configuration is read from
`d2rloader/config/durability-resistance.toml` and takes effect on cold start.
