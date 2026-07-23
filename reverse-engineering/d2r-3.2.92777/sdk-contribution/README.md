# D2RLoader SDK contribution registry

This directory is a living promotion registry for reusable discoveries made
while developing plugins for D2R build 92777. It is not a one-time release and
it is not a dump of the reverse-engineering workbench.

## Lifecycle

1. Keep plugin-specific evidence in its mission and in `known-rvas.json`.
2. Promote only stable, reusable functions, ABIs, fields, layouts, or collision
   contracts into `sdk-candidates.json`.
3. Mirror verified C++ fragments in `verified-layouts.hpp` and explain their
   provenance and limits in `mynotes.md`.
4. Add small reviewed batches as new plugins provide stronger or independent
   evidence. Never silently generalize an RVA to another D2R build.
5. Update `discord-message.md` only when preparing an actual upstream exchange.

Candidates must remain compact, build-pinned, attributable to `RuffnecKk`, and
free of raw Ghidra output, game binaries, analysis caches, speculative full
structures, and unrelated plugin implementation details.

## Source and release artifacts

The versioned source of truth is:

- `sdk-candidates.json` for machine-readable candidates and provenance;
- `verified-layouts.hpp` for minimal compile-time checked layout fragments;
- `mynotes.md` for the human review document;
- `discord-message.md` for the next upstream message draft.

Release ZIPs are generated snapshots, not source. Build one only when sharing a
review batch:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/reverse-engineering/Build-D2RLoaderSdkContribution.ps1
```

The archive is written under `analysis-cache/sdk-contribution/` and contains
only `README.md` (generated from `mynotes.md`), `sdk-candidates.json`, and
`verified-layouts.hpp`.
