[CmdletBinding()]
param(
    [ValidateSet('Status', 'Install')]
    [string]$Command = 'Status'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$packages = @(
    [pscustomobject]@{ Name = 'x64dbg'; Id = 'x64dbg.x64dbg' },
    [pscustomobject]@{ Name = 'Sysinternals Suite'; Id = 'Microsoft.Sysinternals.Suite' },
    [pscustomobject]@{ Name = 'WinDbg'; Id = 'Microsoft.WinDbg' }
)

function Find-WinGetExecutable {
    param(
        [Parameter(Mandatory)]
        [string[]]$Names
    )

    foreach ($name in $Names) {
        $command = Get-Command $name -ErrorAction SilentlyContinue
        if ($null -ne $command -and (Test-Path -LiteralPath $command.Source -PathType Leaf)) {
            return $command.Source
        }
    }

    $packageRoot = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages'
    if (Test-Path -LiteralPath $packageRoot -PathType Container) {
        foreach ($name in $Names) {
            $match = Get-ChildItem -LiteralPath $packageRoot -Recurse -File -Filter $name -ErrorAction SilentlyContinue |
                Select-Object -First 1
            if ($null -ne $match) {
                return $match.FullName
            }
        }
    }

    return $null
}

function Find-WinDbg {
    $command = Get-Command 'windbg.exe' -ErrorAction SilentlyContinue
    if ($null -ne $command -and (Test-Path -LiteralPath $command.Source -PathType Leaf)) {
        return $command.Source
    }

    $package = Get-AppxPackage 'Microsoft.WinDbg' -ErrorAction SilentlyContinue |
        Sort-Object Version -Descending |
        Select-Object -First 1
    if ($null -ne $package) {
        $candidate = Join-Path $package.InstallLocation 'DbgX.Shell.exe'
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
            return $candidate
        }
    }

    return $null
}

if ($Command -eq 'Install') {
    $winget = Get-Command 'winget.exe' -ErrorAction SilentlyContinue
    if ($null -eq $winget) {
        throw 'winget.exe is required to install the runtime tools.'
    }

    foreach ($package in $packages) {
        Write-Output "install=$($package.Name) id=$($package.Id)"
        & $winget.Source install --id $package.Id --exact --source winget --silent --accept-package-agreements --accept-source-agreements --disable-interactivity
        if ($LASTEXITCODE -notin @(0, -1978335189)) {
            throw "winget failed for $($package.Id) with exit code $LASTEXITCODE."
        }
    }
}

$tools = @(
    [pscustomobject]@{ Name = 'x64dbg'; Path = Find-WinGetExecutable -Names @('x64dbg.exe') },
    [pscustomobject]@{ Name = 'ProcDump'; Path = Find-WinGetExecutable -Names @('procdump64.exe', 'procdump.exe') },
    [pscustomobject]@{ Name = 'Process Monitor'; Path = Find-WinGetExecutable -Names @('Procmon64.exe', 'Procmon.exe') },
    [pscustomobject]@{ Name = 'Process Explorer'; Path = Find-WinGetExecutable -Names @('procexp64.exe', 'procexp.exe') },
    [pscustomobject]@{ Name = 'WinDbg'; Path = Find-WinDbg }
)

$missing = @()
foreach ($tool in $tools) {
    if ([string]::IsNullOrWhiteSpace($tool.Path) -or -not (Test-Path -LiteralPath $tool.Path -PathType Leaf)) {
        $missing += $tool.Name
        Write-Output "tool=$($tool.Name) installed=false"
        continue
    }

    $file = Get-Item -LiteralPath $tool.Path
    $version = $file.VersionInfo.ProductVersion
    if ([string]::IsNullOrWhiteSpace($version)) {
        $version = $file.VersionInfo.FileVersion
    }
    Write-Output "tool=$($tool.Name) installed=true version=$version path=$($tool.Path)"
}

if ($missing.Count -gt 0) {
    throw "Missing runtime tools: $($missing -join ', '). Run this script with -Command Install."
}

Write-Output 'runtimeTools=PASS'
