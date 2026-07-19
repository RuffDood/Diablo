[CmdletBinding()]
param(
    [ValidateSet('Import')]
    [string]$Mode = 'Import',
    [switch]$Force
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$workbenchRoot = Join-Path $repoRoot 'reverse-engineering\d2r-3.2.92777'
$config = Get-Content -LiteralPath (Join-Path $workbenchRoot 'workbench.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$image = [IO.Path]::GetFullPath((Join-Path $workbenchRoot ([string]$config.ghidra.inputRelativePath)))
$projectRoot = [IO.Path]::GetFullPath((Join-Path $workbenchRoot ([string]$config.ghidra.projectDirectory)))
$projectName = [string]$config.ghidra.projectName
$ghidraHome = [IO.Path]::GetFullPath([string]$config.ghidra.home)
$javaHome = [IO.Path]::GetFullPath([string]$config.ghidra.javaHome)
$headless = Join-Path $ghidraHome 'support\analyzeHeadless.bat'
$logRoot = Join-Path $workbenchRoot 'analysis-cache\logs'
$projectFile = Join-Path $projectRoot ($projectName + '.gpr')
$projectRep = Join-Path $projectRoot ($projectName + '.rep')

if (-not (Test-Path -LiteralPath $headless -PathType Leaf)) {
    throw "Ghidra headless launcher not found: $headless"
}
if (-not (Test-Path -LiteralPath (Join-Path $javaHome 'bin\java.exe') -PathType Leaf)) {
    throw "Pinned Java runtime not found: $javaHome"
}
$env:JAVA_HOME = $javaHome
if (-not (Test-Path -LiteralPath $image -PathType Leaf)) {
    throw 'Raw Ghidra input missing. Run npm run re:d2r32:init first.'
}
$imageHash = (Get-FileHash -LiteralPath $image -Algorithm SHA256).Hash
if ($imageHash -ne [string]$config.ghidra.inputSha256) {
    throw "Ghidra input hash mismatch: $imageHash"
}
if ((Get-Item -LiteralPath $image).Length -ne [long]$config.ghidra.inputSize) {
    throw 'Ghidra input size mismatch.'
}

New-Item -ItemType Directory -Path $projectRoot,$logRoot -Force | Out-Null
$hasProjectData = (Test-Path -LiteralPath $projectFile -PathType Leaf) -and
    (Test-Path -LiteralPath $projectRep -PathType Container) -and
    ((Get-ChildItem -LiteralPath $projectRep -Recurse -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum -gt 1024)

if ($hasProjectData -and -not $Force) {
    Write-Output 'import=skipped reason=persistent-project-present'
    exit 0
}

$importLog = Join-Path $logRoot 'ghidra-text-import.log'
& $headless $projectRoot $projectName `
    '-import' $image `
    '-overwrite' `
    '-loader' 'BinaryLoader' `
    '-loader-baseAddr' ([string]$config.ghidra.blockBase) `
    '-loader-blockName' '.text' `
    '-processor' 'x86:LE:64:default' `
    '-noanalysis' `
    '-log' $importLog

if ($LASTEXITCODE -ne 0) {
    throw "Ghidra text import failed with exit code $LASTEXITCODE. See $importLog"
}
Write-Output 'import=complete mode=raw-text-lazy-analysis'
