Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$scriptPath = Join-Path $PSScriptRoot 'Sync-BKVince.ps1'
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('diablo-bkvince-sync-' + [guid]::NewGuid().ToString('N'))
$repo = Join-Path $testRoot 'repo'
$game = Join-Path $testRoot 'game'
$source = Join-Path $repo 'data-BKVince\d2rloader\config\sample.toml'
$target = Join-Path $game 'mods\BKVince\d2rloader\config\sample.toml'

try {
    New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($source)) -Force | Out-Null
    New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($target)) -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $repo 'analysis-cache') -Force | Out-Null
    [IO.File]::WriteAllText((Join-Path $game 'D2R.exe'), 'fixture')
    [IO.File]::WriteAllText($source, 'value = 2')
    [IO.File]::WriteAllText($target, 'value = 1')

    & $scriptPath -Mode Plan -RepositoryRoot $repo -GameRoot $game -SourcePath 'data-BKVince/d2rloader/config/sample.toml' | Out-Null
    if ([IO.File]::ReadAllText($target) -ne 'value = 1') { throw 'Plan mode modified the runtime.' }

    & $scriptPath -Mode Apply -RepositoryRoot $repo -GameRoot $game -SourcePath 'data-BKVince/d2rloader/config/sample.toml' | Out-Null
    if ([IO.File]::ReadAllText($target) -ne 'value = 2') { throw 'Apply mode did not synchronize the runtime.' }
    if ((Get-FileHash $source -Algorithm SHA256).Hash -ne (Get-FileHash $target -Algorithm SHA256).Hash) {
        throw 'Source/runtime hashes differ after Apply.'
    }

    $backup = Get-ChildItem (Join-Path $repo 'analysis-cache\runtime-sync-backups') -Recurse -File |
        Where-Object Name -eq 'sample.toml' | Select-Object -First 1
    if ($null -eq $backup -or [IO.File]::ReadAllText($backup.FullName) -ne 'value = 1') {
        throw 'The previous runtime file was not backed up.'
    }

    $refused = $false
    try {
        & $scriptPath -Mode Plan -RepositoryRoot $repo -GameRoot $game -SourcePath (Join-Path $repo 'outside.toml') 2>$null | Out-Null
    } catch { $refused = $_.Exception.Message -match 'outside data-BKVince' }
    if (-not $refused) { throw 'A source outside data-BKVince was not refused.' }

    Write-Output 'VALID : BKVince runtime sync plan/apply/refusal/backup/hash'
} finally {
    if (Test-Path -LiteralPath $testRoot) {
        Remove-Item -LiteralPath $testRoot -Recurse -Force
    }
}
