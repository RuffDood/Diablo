# NoEtherealItemTypes

Hybrid D2RLoader plugin for D2R 3.2.92777. Version 1.1.0 can be installed
globally in `d2rloader/plugins` or locally in a mod's plugin folder.

The plugin hooks `ITEMS_CheckItemTypeId` at RVA `0x00373890`, but changes its
answer only for the two calls made by the ethereal-generation path (return RVAs
`0x004432DA` and `0x004432E9`). Configured codes are resolved from the active
runtime `itemtypes` table and checked with D2R's native equivalence hierarchy.

An excluded eligible item leaves the ethereal path before quality checks, RNG,
forced-ethereal flags and stat changes. This makes the exclusion absolute: a
configured family cannot become ethereal through a natural roll, a set-item
rule, a cube output that requests ethereal, or another always-ethereal creation
flag.

Configuration is read from
`d2rloader/config/no-ethereal-item-types.toml` and takes effect on cold start.
Use the `no-ethereal-item-types` console command to inspect resolved codes and
the number of eligible generations excluded by the policy.
