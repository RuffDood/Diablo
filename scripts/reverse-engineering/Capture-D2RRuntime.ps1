[CmdletBinding()]
param(
    [ValidateSet('Crash', 'Hang', 'CrashOrHang')]
    [string]$Mode = 'CrashOrHang',
    [ValidateSet('Mini', 'MiniPlus', 'Full')]
    [string]$DumpType = 'MiniPlus',
    [ValidateRange(1, 20)]
    [int]$MaxDumps = 3,
    [string]$ProcessName = 'D2R.exe',
    [string]$DumpDirectory,
    [switch]$Background,
    [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Find-ProcDump {
    foreach ($name in @('procdump64.exe', 'procdump.exe')) {
        $command = Get-Command $name -ErrorAction SilentlyContinue
        if ($null -ne $command -and (Test-Path -LiteralPath $command.Source -PathType Leaf)) {
            return $command.Source
        }
    }

    $packageRoot = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages'
    if (Test-Path -LiteralPath $packageRoot -PathType Container) {
        foreach ($name in @('procdump64.exe', 'procdump.exe')) {
            $match = Get-ChildItem -LiteralPath $packageRoot -Recurse -File -Filter $name -ErrorAction SilentlyContinue |
                Select-Object -First 1
            if ($null -ne $match) {
                return $match.FullName
            }
        }
    }

    throw 'ProcDump was not found. Run npm.cmd run re:tools -- Install first.'
}

$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
if ([string]::IsNullOrWhiteSpace($DumpDirectory)) {
    $DumpDirectory = Join-Path $repoRoot 'analysis-cache\runtime\dumps'
}
$DumpDirectory = [IO.Path]::GetFullPath($DumpDirectory)
New-Item -ItemType Directory -Path $DumpDirectory -Force | Out-Null

$procdump = Find-ProcDump
$dumpSwitch = switch ($DumpType) {
    'Mini' { '-mm' }
    'MiniPlus' { '-mp' }
    'Full' { '-ma' }
}
$arguments = @('-accepteula', $dumpSwitch, '-n', $MaxDumps.ToString())
switch ($Mode) {
    'Crash' { $arguments += '-e' }
    'Hang' { $arguments += '-h' }
    'CrashOrHang' { $arguments += @('-e', '-h') }
}
$arguments += @('-w', $ProcessName, $DumpDirectory)

Write-Output "procdump=$procdump"
Write-Output "mode=$Mode dumpType=$DumpType maxDumps=$MaxDumps process=$ProcessName"
Write-Output "dumpDirectory=$DumpDirectory"
Write-Warning 'Memory dumps can contain sensitive process data. Keep them inside analysis-cache and do not commit or share them without review.'

if ($DryRun) {
    Write-Output "capture=DRY_RUN arguments=$($arguments -join ' ')"
    exit 0
}

if ($Background) {
    $monitor = Start-Process -FilePath $procdump -ArgumentList $arguments -PassThru -WindowStyle Hidden
    Write-Output "capture=RUNNING pid=$($monitor.Id)"
    exit 0
}

& $procdump @arguments
exit $LASTEXITCODE
