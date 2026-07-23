[CmdletBinding()]
param(
    [string]$OutputPath
)

$ErrorActionPreference = 'Stop'

$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$sourceRoot = Join-Path $repoRoot 'reverse-engineering\d2r-3.2.92777\sdk-contribution'
$releaseRoot = Join-Path $repoRoot 'analysis-cache\sdk-contribution'

if ([string]::IsNullOrWhiteSpace($OutputPath)) {
    $OutputPath = Join-Path $releaseRoot 'RuffnecKk-D2RLoader-SDK-notes-92777.zip'
}

$outputFull = [IO.Path]::GetFullPath($OutputPath)
$releaseFull = [IO.Path]::GetFullPath($releaseRoot)
if (-not $outputFull.StartsWith($releaseFull + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw "OutputPath must remain under $releaseFull"
}

$inputs = @(
    @{ Source = 'mynotes.md'; Archive = 'README.md' },
    @{ Source = 'sdk-candidates.json'; Archive = 'sdk-candidates.json' },
    @{ Source = 'verified-layouts.hpp'; Archive = 'verified-layouts.hpp' }
)

foreach ($input in $inputs) {
    $source = Join-Path $sourceRoot $input.Source
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
        throw "Missing contribution source: $source"
    }
}

New-Item -ItemType Directory -Force -Path $releaseFull | Out-Null
$stage = Join-Path $releaseFull ('stage-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $stage | Out-Null

try {
    foreach ($input in $inputs) {
        Copy-Item -LiteralPath (Join-Path $sourceRoot $input.Source) -Destination (Join-Path $stage $input.Archive)
    }

    if (Test-Path -LiteralPath $outputFull) {
        Remove-Item -LiteralPath $outputFull
    }
    Compress-Archive -LiteralPath ($inputs | ForEach-Object { Join-Path $stage $_.Archive }) -DestinationPath $outputFull -CompressionLevel Optimal

    $entries = @(tar -tf $outputFull | Sort-Object)
    $expected = @($inputs.Archive | Sort-Object)
    if (($entries -join "`n") -ne ($expected -join "`n")) {
        throw "Unexpected archive entries: $($entries -join ', ')"
    }

    $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $outputFull).Hash
    Write-Output "archive=$outputFull"
    Write-Output "sha256=$hash"
    Write-Output "entries=$($entries -join ',')"
}
finally {
    $stageFull = [IO.Path]::GetFullPath($stage)
    if ($stageFull.StartsWith($releaseFull + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $stageFull)) {
        Remove-Item -LiteralPath $stageFull -Recurse
    }
}
