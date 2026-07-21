# BKVince Mod Hero Editor

Client-side hero editor driven by the active BKVince 3.2 TXT tables. Save files
stay in the browser; the app does not upload them or depend on a database.

## Current milestone

- Generates a deterministic catalog from
  `data-BKVince/BKVince.mpq/data/global/excel/`.
- Validates D2S v104/v105 headers, checksum, player stats, skills, item count,
  and the empty-corpse boundary used by the safe insertion path.
- Serializes supported unique `misc` items with BKVince `Save Bits`, `Save Add`,
  `Save Param Bits`, and `ValShift` values.
- Supports minimum, maximum, or seeded random rolls.
- Inserts the item into a copy, updates size/checksum/count, reparses the result,
  and downloads it under a new filename.
- Rejects unsupported properties, containers, ranges, and item forms rather than
  guessing a vanilla encoding.

The first runtime gate is Annihilus. A generated copy of `DummyTester.d2s` was
accepted by BKVince/D2R 3.2.92777 and loaded in-game without `bad dead bodies`.

## Commands

```powershell
npm run dev --workspace apps/hero-editor
npm run build --workspace apps/hero-editor
npm run inspect:save --workspace apps/hero-editor -- C:\path\Character.d2s
npm run forge:save --workspace apps/hero-editor -- C:\input.d2s C:\output.d2s Annihilus max 10 7
```

The CLI also refuses to overwrite its input file. Generated integration-test
saves belong under `analysis-cache/` and must not be committed.

## Next gates

The current insertion gate is intentionally narrow. Full item-boundary parsing,
occupied-cell detection, visual inventory editing, removal/movement, additional
qualities, sockets, stackables, equipment, stash, Cube, mercenary, and D2I
support remain on the roadmap.

See `THIRD_PARTY_NOTICES.md` for the pinned save-format reference.
