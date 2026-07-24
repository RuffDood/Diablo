[CmdletBinding()]
param(
    [ValidateSet('Plan', 'Apply')]
    [string]$Mode = 'Plan',
    [Parameter(Mandatory)]
    [string[]]$SourcePath,
    [string]$GameRoot,
    [string]$RepositoryRoot,
    [switch]$Restart,
    [string[]]$LauncherArguments = @(),
    [ValidateRange(1, 120)]
    [int]$StartupTimeoutSeconds = 20
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Resolve-Root {
    param([string]$Value, [string]$Fallback)
    $candidate = if ([string]::IsNullOrWhiteSpace($Value)) { $Fallback } else { $Value }
    if ([string]::IsNullOrWhiteSpace($candidate)) { return $null }
    return [IO.Path]::GetFullPath($candidate).TrimEnd('\')
}

function Test-ChildPath {
    param([string]$Child, [string]$Parent)
    $prefix = $Parent.TrimEnd('\') + [IO.Path]::DirectorySeparatorChar
    return $Child.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)
}

function Find-GameRoot {
    param([string]$ExplicitRoot)
    $resolved = Resolve-Root -Value $ExplicitRoot -Fallback $env:D2R_GAME_ROOT
    if ($null -ne $resolved) { return $resolved }

    $running = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -in @('D2R.exe', 'D2RLoader.exe') -and $_.ExecutablePath } |
        Select-Object -First 1
    if ($null -ne $running) {
        return [IO.Path]::GetDirectoryName($running.ExecutablePath)
    }

    $registryCandidates = @(
        'HKLM:\SOFTWARE\WOW6432Node\Blizzard Entertainment\Diablo II Resurrected',
        'HKLM:\SOFTWARE\Blizzard Entertainment\Diablo II Resurrected'
    )
    foreach ($key in $registryCandidates) {
        $item = Get-ItemProperty -LiteralPath $key -ErrorAction SilentlyContinue
        foreach ($property in @('InstallPath', 'InstallLocation')) {
            if ($null -ne $item -and -not [string]::IsNullOrWhiteSpace($item.$property)) {
                return [IO.Path]::GetFullPath($item.$property).TrimEnd('\')
            }
        }
    }
    throw 'D2R game root was not found. Pass -GameRoot or set D2R_GAME_ROOT.'
}

function Get-OwnedProcesses {
    param([string]$ResolvedGameRoot)
    return @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object {
            $_.Name -in @('D2R.exe', 'D2RLoader.exe') -and
            $_.ExecutablePath -and
            (Test-ChildPath -Child ([IO.Path]::GetFullPath($_.ExecutablePath)) -Parent $ResolvedGameRoot)
        })
}

function Stop-OwnedProcesses {
    param([string]$ResolvedGameRoot)
    $owned = @(Get-OwnedProcesses -ResolvedGameRoot $ResolvedGameRoot)
    foreach ($process in $owned) {
        Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop
    }
    if ($owned.Count -gt 0) {
        $deadline = [DateTime]::UtcNow.AddSeconds(15)
        do {
            Start-Sleep -Milliseconds 200
            $remaining = @(Get-OwnedProcesses -ResolvedGameRoot $ResolvedGameRoot)
        } while ($remaining.Count -gt 0 -and [DateTime]::UtcNow -lt $deadline)
        if ($remaining.Count -gt 0) {
            throw "D2R processes did not stop: $($remaining.ProcessId -join ', ')"
        }
    }
    return $owned.Count
}

$repoRoot = Resolve-Root -Value $RepositoryRoot -Fallback ([IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..')))
$game = Find-GameRoot -ExplicitRoot $GameRoot
$sourceRoot = [IO.Path]::GetFullPath((Join-Path $repoRoot 'data-BKVince')).TrimEnd('\')
$runtimeRoot = [IO.Path]::GetFullPath((Join-Path $game 'mods\BKVince')).TrimEnd('\')

if (-not (Test-Path -LiteralPath (Join-Path $game 'D2R.exe') -PathType Leaf)) {
    throw "D2R.exe is missing under game root: $game"
}
if (-not (Test-Path -LiteralPath $sourceRoot -PathType Container)) {
    throw "Governed source root is missing: $sourceRoot"
}
if (-not (Test-Path -LiteralPath $runtimeRoot -PathType Container)) {
    throw "BKVince runtime root is missing: $runtimeRoot"
}

$requested = @($SourcePath | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim() } |
    Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Sort-Object -Unique)
if ($requested.Count -eq 0) { throw 'At least one source file is required.' }

$entries = @(foreach ($item in $requested) {
    $source = if ([IO.Path]::IsPathRooted($item)) {
        [IO.Path]::GetFullPath($item)
    } else {
        [IO.Path]::GetFullPath((Join-Path $repoRoot $item))
    }
    if (-not (Test-ChildPath -Child $source -Parent $sourceRoot)) {
        throw "Source is outside data-BKVince: $item"
    }
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
        throw "Source file does not exist: $item"
    }
    $relative = $source.Substring($sourceRoot.Length + 1)
    if ($relative -match '(^|[\\/])[^\\/]+-src([\\/]|$)' -or $relative -match '\.(bak|pdb|exp|lib|obj)$') {
        throw "Source is not deployable runtime content: $relative"
    }
    $target = [IO.Path]::GetFullPath((Join-Path $runtimeRoot $relative))
    if (-not (Test-ChildPath -Child $target -Parent $runtimeRoot)) {
        throw "Runtime target escaped BKVince: $relative"
    }
    $sourceHash = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash
    $targetHash = if (Test-Path -LiteralPath $target -PathType Leaf) {
        (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash
    } else { $null }
    [pscustomobject]@{
        relative = $relative.Replace('\', '/')
        source = $source
        target = $target
        sourceSha256 = $sourceHash
        targetSha256Before = $targetHash
        changed = $sourceHash -ne $targetHash
    }
})

$startedAt = [DateTime]::UtcNow
$reportRoot = Join-Path $repoRoot 'analysis-cache\runtime-sync'
New-Item -ItemType Directory -Path $reportRoot -Force | Out-Null
$runId = $startedAt.ToString('yyyyMMdd-HHmmssfff')
$backupRoot = Join-Path $repoRoot "analysis-cache\runtime-sync-backups\$runId"
$stopped = 0
$launcherPid = $null

if ($Mode -eq 'Apply' -and @($entries | Where-Object changed).Count -gt 0) {
    $stopped = Stop-OwnedProcesses -ResolvedGameRoot $game
    foreach ($entry in $entries | Where-Object changed) {
        if (Test-Path -LiteralPath $entry.target -PathType Leaf) {
            $backup = Join-Path $backupRoot $entry.relative
            New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($backup)) -Force | Out-Null
            Copy-Item -LiteralPath $entry.target -Destination $backup -Force
        }
        New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($entry.target)) -Force | Out-Null
        Copy-Item -LiteralPath $entry.source -Destination $entry.target -Force
        $runtimeHash = (Get-FileHash -LiteralPath $entry.target -Algorithm SHA256).Hash
        if ($runtimeHash -ne $entry.sourceSha256) {
            throw "Hash mismatch after copy: $($entry.relative)"
        }
        $entry | Add-Member -NotePropertyName targetSha256After -NotePropertyValue $runtimeHash
    }
}

if ($Mode -eq 'Apply' -and $Restart) {
    if (@(Get-OwnedProcesses -ResolvedGameRoot $game).Count -gt 0) {
        throw 'Refusing restart because a D2R or D2RLoader instance is already running for this game root.'
    }
    $launcher = Join-Path $game 'D2RLoader.exe'
    if (-not (Test-Path -LiteralPath $launcher -PathType Leaf)) {
        throw "D2RLoader.exe is missing: $launcher"
    }
    $process = Start-Process -FilePath $launcher -ArgumentList $LauncherArguments -WorkingDirectory $game -WindowStyle Hidden -PassThru
    $launcherPid = $process.Id
    $deadline = [DateTime]::UtcNow.AddSeconds($StartupTimeoutSeconds)
    do {
        Start-Sleep -Milliseconds 500
        $running = @(Get-OwnedProcesses -ResolvedGameRoot $game)
    } while ($running.Count -eq 0 -and [DateTime]::UtcNow -lt $deadline)
    if ($running.Count -eq 0) { throw 'No D2R or D2RLoader process was observed after restart.' }

    $logRoot = Join-Path $runtimeRoot 'd2rloader\logs'
    do {
        $newestLog = if (Test-Path -LiteralPath $logRoot -PathType Container) {
            Get-ChildItem -LiteralPath $logRoot -File -Recurse |
                Where-Object LastWriteTimeUtc -ge $startedAt |
                Sort-Object LastWriteTimeUtc -Descending |
                Select-Object -First 1
        } else { $null }
        if ($null -eq $newestLog) { Start-Sleep -Milliseconds 500 }
    } while ($null -eq $newestLog -and [DateTime]::UtcNow -lt $deadline)
}

$freshLogs = @()
$logRoot = Join-Path $runtimeRoot 'd2rloader\logs'
if (Test-Path -LiteralPath $logRoot -PathType Container) {
    $freshLogs = @(Get-ChildItem -LiteralPath $logRoot -File -Recurse |
        Where-Object LastWriteTimeUtc -ge $startedAt |
        Select-Object FullName, Length, LastWriteTimeUtc)
}

$report = [ordered]@{
    schemaVersion = 1
    mode = $Mode
    startedAtUtc = $startedAt.ToString('o')
    repositoryRoot = $repoRoot
    gameRoot = $game
    runtimeRoot = $runtimeRoot
    requestedFiles = $entries.Count
    changedFiles = @($entries | Where-Object changed).Count
    stoppedProcesses = $stopped
    restarted = [bool]$Restart
    launcherPid = $launcherPid
    backupRoot = if (Test-Path -LiteralPath $backupRoot) { $backupRoot } else { $null }
    files = $entries
    freshLogs = $freshLogs
}
$reportPath = Join-Path $reportRoot "$runId-$($Mode.ToLowerInvariant()).json"
[IO.File]::WriteAllText($reportPath, ($report | ConvertTo-Json -Depth 8) + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))

foreach ($entry in $entries) {
    Write-Output "file=$($entry.relative) changed=$($entry.changed) source=$($entry.sourceSha256) targetBefore=$($entry.targetSha256Before)"
}
Write-Output "mode=$Mode files=$($entries.Count) changed=$(@($entries | Where-Object changed).Count) stopped=$stopped restarted=$([bool]$Restart)"
Write-Output "report=$reportPath"
Write-Output 'bkvinceSync=PASS'
