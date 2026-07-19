# DurabilityResistance

Mod-local D2RLoader plugin for BKVince on D2R 3.2.92777.

It hooks the native durability update routine at RVA `0x00441B10`. A separate
resistance percentage can suppress otherwise eligible durability checks for
normal and ethereal equipment. The vanilla 4% weapon and 10% armor chances are
preserved as the base probabilities, and each successful native check still
removes exactly one durability point.

Throwable quantity is outside this hook's policy. Throwable items are routed
directly to the original routine without an added resistance roll.

The optional ethereal maximum setting is applied only to the base-stat read
returning at RVA `0x0044351F`, immediately before D2R's native
`(maximum / 2) + 1` calculation. Other stat reads are returned unchanged.

Configuration is read from
`d2rloader/config/durability-resistance.toml` and takes effect on cold start.
