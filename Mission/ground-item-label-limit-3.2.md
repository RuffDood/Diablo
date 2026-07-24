# Ground item label limit — D2R 3.2.92777

## Goal

Raise the vanilla limit of 32 simultaneous ground item labels without changing
item drops, pickup behavior or loot-filter rules.

## Proven rendering path

The persistent 92777 workbench establishes the following chain:

1. `ITEMS_GetDisplayName` at RVA `0x9A1B0` resolves the localized display name
   for an item unit.
2. `UI_BuildGroundItemTooltip` at RVA `0xCBEB0` has the independently known 2.4
   ABI `(unit, textBuffer, bufferSize, colorCode)` and calls the name resolver.
3. Its only direct caller is the ground-label record builder at RVA `0x1FA9F0`.
4. The remastered renderer calls that builder while filling `0x144`-byte label
   records in the collection managed around RVA `0x1516D60`.

At RVA `0x1516EBE`, the renderer compares the collection size with `0x20`. If
the collection is larger, it erases records beginning at
`base + 0x2880`, where `0x2880 = 32 * 0x144`. If it is smaller, RVA
`0x1516F41` appends `32 - size` default records. This proves a fixed logical
capacity of 32 backed by a dynamically allocated vector.

A second synchronized layout list is normalized to 32 nodes around RVA
`0x1519A14`. Its comparisons at `0x1519A4F`, `0x1519AAA` and `0x1519AF9`
must change with the label-record collection.

## Implementation

`GroundItemLabelLimit` validates all seven complete 92777 signatures before
performing any write. It then changes both synchronized capacities and derives
the label-vector byte offset as `configuredLimit * 0x144`.

The TOML default is 64 labels. Accepted values are 33 through 127. The upper
bound preserves the signed one-byte immediate encoding used by the existing
comparison instructions. The plugin declares no mod-only flag and therefore
works from global and mod-local D2RLoader plugin directories.

## Static validation

- Release build: MSVC 19.44, x64.
- Policy tests cover the accepted range and `0x144` offset calculation.
- All seven original byte signatures come from the verified local analysis
  image whose canonical build is D2R 3.2.92777.

Runtime validation still needs a dense pile containing more than 32 visible
items to confirm the chosen default under both remastered and legacy rendering.
