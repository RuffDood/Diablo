# Qty Display Issue

Restores the quantity line on socketed stackable item tooltips in D2R
3.2.92777. The plugin is compatible with global and mod-local D2RLoader
installations.

The plugin hooks `ITEMS_GetStatsDescription` at RVA `0x2DC4B0` only after a
strict 32-byte signature check. It reads the current `STAT_QUANTITY` through
the game's own stat accessor and obtains the maximum from
`ITEMS_GetTotalMaxStack` at RVA `0x3719E0`. The line is added only when the
item has the socketed flag and both values are positive.

`QtyDisplayIssue.json` is loaded from the active mod first, then from the game
directory. Missing configuration uses the enabled default; malformed JSON is
rejected.

```jsonc
{
    "enabled": true
}
```

This standalone DLL is incubated for a future merge into eezstreet's
`plugin-items.dll`. Its flat JSON object will become `items.qtyDisplayIssue`
inside `D2RPlugins.json`. The standalone plugin does not modify, link or
redistribute any eezstreet DLL.
