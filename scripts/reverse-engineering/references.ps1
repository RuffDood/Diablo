[CmdletBinding(PositionalBinding = $false)]
param(
    [string]$Reference,

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

$scriptPath = Join-Path $PSScriptRoot 'references.py'
$env:PYTHONUTF8 = '1'
$pythonArguments = @($Arguments | Where-Object { $null -ne $_ -and $_ -ne '' })
if (-not [string]::IsNullOrWhiteSpace($Reference)) {
    if ($pythonArguments.Count -eq 0) {
        $pythonArguments = @('status', $Reference)
    }
    elseif ($pythonArguments[0] -eq 'list') {
        throw 'The list command does not accept a preselected reference.'
    }
    elseif ($pythonArguments.Count -eq 1) {
        $pythonArguments = @($pythonArguments[0], $Reference)
    }
    else {
        $pythonArguments = @($pythonArguments[0], $Reference) + $pythonArguments[1..($pythonArguments.Count - 1)]
    }
}
& $python $scriptPath @pythonArguments
exit $LASTEXITCODE
