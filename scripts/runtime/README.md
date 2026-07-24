# BKVince runtime synchronization

`Sync-BKVince.ps1` copies only explicitly named runtime files from the governed
`data-BKVince/` source to `<D2R>/mods/BKVince/`.

Plan a synchronization without writing:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/runtime/Sync-BKVince.ps1 `
  -Mode Plan `
  -GameRoot $env:D2R_GAME_ROOT `
  -SourcePath data-BKVince/d2rloader/plugins/GambleScreenLimit.dll,data-BKVince/BKVince.mpq/GambleScreenLimit.json
```

Apply the same closed allowlist:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/runtime/Sync-BKVince.ps1 `
  -Mode Apply `
  -GameRoot $env:D2R_GAME_ROOT `
  -SourcePath data-BKVince/d2rloader/plugins/GambleScreenLimit.dll,data-BKVince/BKVince.mpq/GambleScreenLimit.json
```

Pass `-Restart` only when the validation matrix requires a cold start. Optional
arguments for `D2RLoader.exe` belong in `-LauncherArguments`. The script never
commits or pushes changes.

Reports and recoverable runtime backups are written below `analysis-cache/`.
They remain local and must not be committed.
