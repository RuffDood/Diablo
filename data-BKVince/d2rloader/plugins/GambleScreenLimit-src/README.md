# Gamble Screen Limit

Raises the number of item-generation attempts used to populate the gambling
screen in D2R 3.2.92777. The plugin is compatible with global and mod-local
D2RLoader installations.

The governed patch changes only the immediate byte in the unique loop bound at
RVA `0x541A7E`. The complete original signature is
`83 FD 0E 0F 8C DB FE FF FF`; incompatible builds are rejected.

The default is 32 items. Configure `itemLimit` from 14 through 127 in
`GambleScreenLimit.json`. The standalone JSON supports comments and is loaded
from the active mod first, then from the game directory. Higher values require in-game validation because
item size, placement, UI navigation and network delivery can reduce the number
of usable entries independently of the generation loop.

This standalone DLL is incubated for a future merge into eezstreet's
`plugin-items.dll`. Its flat JSON object will become
`items.gambleScreenLimit` in the shared `D2RPlugins.json` after that merge.
