# Advanced Item Tooltips

Hybrid D2RLoader plugin for D2R 3.2.92777. It can be installed either in the
global `d2rloader/plugins` directory or in a mod-local plugin directory.

The plugin adds the native maximum socket count in vanilla gray and reads the
active mod's TXT tables to append variable affix and base-defense ranges in
green. Fixed affixes are intentionally left unchanged. Negative rolled values
keep their sign while their range is presented as positive magnitudes.
Affix and base-defense ranges are only exposed for identified items; the plugin
never reveals hidden modifiers on unidentified items.

The implementation refuses to install its hook on an unsupported executable
signature or D2R build. Use the `advanced-item-tooltips` console command to
inspect runtime counters.
