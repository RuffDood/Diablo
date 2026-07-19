[CmdletBinding()]
param(
    [string]$ImagePath,
    [string]$SectionSourcePath,
    [switch]$SkipIndex
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$workbenchRoot = Join-Path $repoRoot 'reverse-engineering\d2r-3.2.92777'
$configPath = Join-Path $workbenchRoot 'workbench.json'
$config = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
$destination = Join-Path $workbenchRoot ([string]$config.canonicalImage.relativePath)
$destination = [IO.Path]::GetFullPath($destination)
$analysisDestination = [IO.Path]::GetFullPath((Join-Path $workbenchRoot ([string]$config.analysisImage.relativePath)))
$cacheRoot = [IO.Path]::GetFullPath((Join-Path $workbenchRoot 'analysis-cache'))

if (-not $destination.StartsWith($cacheRoot + '\', [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing image destination outside the workbench cache: $destination"
}

if ([string]::IsNullOrWhiteSpace($ImagePath)) {
    $legacyCandidate = Join-Path $env:LOCALAPPDATA 'Temp\codex-d2r-92777-analysis\D2R-3.2.92777-decrypted.exe'
    if (Test-Path -LiteralPath $legacyCandidate -PathType Leaf) {
        $ImagePath = $legacyCandidate
    }
}

if (-not (Test-Path -LiteralPath $destination -PathType Leaf)) {
    if ([string]::IsNullOrWhiteSpace($ImagePath)) {
        throw 'No canonical image is installed. Pass -ImagePath with the governed decrypted 92777 image.'
    }
    $source = [IO.Path]::GetFullPath($ImagePath)
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
        throw "Image source not found: $source"
    }
    $sourceHash = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash
    if ($sourceHash -ne [string]$config.canonicalImage.sha256) {
        throw "Refusing non-canonical image. Expected $($config.canonicalImage.sha256), got $sourceHash"
    }
    if ((Get-Item -LiteralPath $source).Length -ne [long]$config.canonicalImage.size) {
        throw 'Refusing image with an unexpected file size.'
    }
    New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
    Copy-Item -LiteralPath $source -Destination $destination
}

$installedHash = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash
if ($installedHash -ne [string]$config.canonicalImage.sha256) {
    throw "Installed image is not canonical: $installedHash"
}

Write-Output "image=$destination"
Write-Output "sha256=$installedHash"
Write-Output 'verified=true'

if (-not (Test-Path -LiteralPath $analysisDestination -PathType Leaf)) {
    if ([string]::IsNullOrWhiteSpace($SectionSourcePath)) {
        $installedGame = 'C:\Games\Diablo II Resurrected\D2R.exe'
        if (Test-Path -LiteralPath $installedGame -PathType Leaf) {
            $SectionSourcePath = $installedGame
        }
    }
    if ([string]::IsNullOrWhiteSpace($SectionSourcePath)) {
        throw 'No same-build PE metadata source was found. Pass -SectionSourcePath with D2R.exe.'
    }
    & (Join-Path $PSScriptRoot 'd2r32.ps1') hydrate --source $SectionSourcePath
    if ($LASTEXITCODE -ne 0) {
        throw "Analysis image hydration failed with exit code $LASTEXITCODE"
    }
}

$analysisHash = (Get-FileHash -LiteralPath $analysisDestination -Algorithm SHA256).Hash
if ($analysisHash -ne [string]$config.analysisImage.sha256) {
    throw "Analysis image is not canonical: $analysisHash"
}
Write-Output "analysisImage=$analysisDestination"
Write-Output "analysisSha256=$analysisHash"

& (Join-Path $PSScriptRoot 'd2r32.ps1') extract-text
if ($LASTEXITCODE -ne 0) {
    throw "Ghidra input extraction failed with exit code $LASTEXITCODE"
}

if (-not $SkipIndex) {
    & (Join-Path $PSScriptRoot 'd2r32.ps1') index
    if ($LASTEXITCODE -ne 0) {
        throw "Index construction failed with exit code $LASTEXITCODE"
    }
}
