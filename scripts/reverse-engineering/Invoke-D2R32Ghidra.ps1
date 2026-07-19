[CmdletBinding(PositionalBinding = $false)]
param(
    [Parameter(Position = 0)]
    [ValidateSet('status', 'function', 'xrefs-to', 'xrefs-from')]
    [string]$Mode = 'status',
    [Parameter(Position = 1)]
    [string]$Rva,
    [Parameter(Position = 2)]
    [int]$Limit = 160
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$workbenchRoot = Join-Path $repoRoot 'reverse-engineering\d2r-3.2.92777'
$config = Get-Content -LiteralPath (Join-Path $workbenchRoot 'workbench.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$projectRoot = [IO.Path]::GetFullPath((Join-Path $workbenchRoot ([string]$config.ghidra.projectDirectory)))
$projectName = [string]$config.ghidra.projectName
$programName = [string]$config.ghidra.programName
$functionMap = [IO.Path]::GetFullPath((Join-Path $workbenchRoot ([string]$config.ghidra.functionMapRelativePath)))
$headless = Join-Path ([string]$config.ghidra.home) 'support\analyzeHeadless.bat'
$javaHome = [IO.Path]::GetFullPath([string]$config.ghidra.javaHome)
$projectFile = Join-Path $projectRoot ($projectName + '.gpr')

if (-not (Test-Path -LiteralPath (Join-Path $javaHome 'bin\java.exe') -PathType Leaf)) {
    throw "Pinned Java runtime not found: $javaHome"
}
$env:JAVA_HOME = $javaHome

if (-not (Test-Path -LiteralPath $projectFile -PathType Leaf)) {
    throw 'Persistent Ghidra project missing. Run npm run re:d2r32:ghidra-import first.'
}
if (-not (Test-Path -LiteralPath $functionMap -PathType Leaf)) {
    throw 'Function map missing. Run npm run re:d2r32:init first.'
}

$scriptArguments = @($Mode)
if ($Mode -ne 'status') {
    if ([string]::IsNullOrWhiteSpace($Rva)) {
        throw "$Mode requires an RVA."
    }
    $scriptArguments += @($Rva, [string]$Limit)
}
$scriptArguments += $functionMap

$rawOutput = @(
    & $headless $projectRoot $projectName '-process' $programName '-noanalysis' '-scriptPath' (Join-Path $PSScriptRoot 'ghidra') '-postScript' 'D2RQuery.java' @scriptArguments 2>&1
)
$exitCode = $LASTEXITCODE

if ($exitCode -ne 0) {
    $rawOutput | ForEach-Object { Write-Error ([string]$_) }
    exit $exitCode
}

$matched = 0
foreach ($line in $rawOutput) {
    $text = [string]$line
    if ($text -match 'D2RQuery\.java>\s?(.*?)\s+\(GhidraScript\)\s*$') {
        Write-Output $Matches[1]
        $matched++
    }
}

if ($matched -eq 0) {
    throw 'Ghidra completed without returning any D2RQuery output.'
}
exit 0
