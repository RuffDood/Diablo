# Transmogrify

Restores the legacy TXT-driven right-click transformation behavior in D2R 3.2.92777.

## Configuration

Configure a source row in `armor.txt`, `weapons.txt`, or `misc.txt`:

- `Transmogrify = 1` enables the source item.
- `TMogType` is the output item code.
- `TMogMin` and `TMogMax` optionally roll the output quantity when both are non-zero.

The player can right-click the source from the main inventory, Horadric Cube, personal stash, or shared stash. The output is created in the same container as the source: inventory to inventory, Cube to Cube, and stash to the same stash. The source slot is freed while the plugin searches for a valid output position, so a full container can still succeed when the output fits in that space. If no valid position exists in that container, the conversion is cancelled and the source item is restored without being consumed.

Outputs are created at normal quality with automatic socket rolls disabled. This affects only items created by Transmogrify; ordinary game drops keep their native socket behavior.

Eligible items display a red localized conversion line below their requirements when applicable, such as `Right Click to make Minor Mana Potion`. The plugin combines D2R's native `convertsto` string (ID 5387) with the localized name of the `TMogType` output.

### Manual tooltip override

Configuration is read from `d2rloader/config/transmogrify.toml` in the same global or mod-local scope as the DLL and takes effect after a cold start.

- `manual_text = ""` keeps the automatic localized tooltip based on `TMogType`.
- A non-empty value replaces it on every eligible item, for example `manual_text = "Right Click to Transmog..."`.

The override changes only the red tooltip line. It does not define recipes, outputs, or probabilities.

The plugin is hybrid: install the same DLL in either `<D2R>/d2rloader/plugins/` or `<D2R>/mods/<mod>/d2rloader/plugins/`. In multiplayer, both the client and the authoritative host must load the plugin and use matching TXT data.
