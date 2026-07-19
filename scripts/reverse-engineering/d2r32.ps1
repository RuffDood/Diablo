[CmdletBinding(PositionalBinding = $false)]
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Arguments
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$pythonCandidates = @(
    (Join-Path $env:LOCALAPPDATA 'Programs\Python\Python312\python.exe'),
    (Join-Path $env:LOCALAPPDATA 'Programs\Python\Python313\python.exe'),
    (Join-Path $env:LOCALAPPDATA 'Programs\Python\Python311\python.exe')
)

$python = $pythonCandidates |
    Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } |
    Select-Object -First 1

if ([string]::IsNullOrWhiteSpace($python)) {
    $pythonCommand = Get-Command 'python.exe' -ErrorAction SilentlyContinue
    if ($null -ne $pythonCommand -and $pythonCommand.Source -notlike '*\WindowsApps\python.exe') {
        $python = $pythonCommand.Source
    }
}

if ([string]::IsNullOrWhiteSpace($python)) {
    throw 'A real Python 3 installation is required; the Microsoft Store alias is not sufficient.'
}

$scriptPath = Join-Path $PSScriptRoot 'd2r32.py'
$env:PYTHONUTF8 = '1'
& $python $scriptPath @Arguments
exit $LASTEXITCODE
