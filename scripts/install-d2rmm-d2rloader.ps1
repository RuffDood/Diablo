[CmdletBinding()]
param(
    [string]$GameRoot = 'C:\Games\Diablo II Resurrected',
    [string]$LegacyD2RMMRoot = 'C:\Games\Diablo II Resurrected\D2RMM 1.8.0'
)

$ErrorActionPreference = 'Stop'

$release = [ordered]@{
    Version = '1.9.1'
    Commit = '634a39199fb819d2228e8aba7924e1515a291316'
    Uri = 'https://github.com/yinyin333333/d2rmm/releases/download/1.9.1/D2RMM.Custom.1.9.1.zip'
    Sha256 = '1D09425B4DCF69190D4F01459FD61C66C49E9D5B3D0FB534AEE1C724BA7A7DC6'
}

$requiredPaths = @(
    (Join-Path $GameRoot 'D2R.exe'),
    (Join-Path $GameRoot 'D2RLoader.exe'),
    (Join-Path $GameRoot 'd2rloader\config\d2rloader.toml'),
    (Join-Path $GameRoot 'mods\BKVince\BKVince.mpq\modinfo.json')
)

foreach ($requiredPath in $requiredPaths) {
    if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
        throw "Required D2RLoader/BKVince file is missing: $requiredPath"
    }
}

$destination = Join-Path $GameRoot "D2RMM Custom $($release.Version)"
$executable = Join-Path $destination 'D2RMM Custom.exe'
if (Test-Path -LiteralPath $executable -PathType Leaf) {
    Write-Output "D2RMM Custom $($release.Version) is already installed: $executable"
    exit 0
}
if (Test-Path -LiteralPath $destination) {
    throw "Refusing to replace a partial or unknown installation: $destination"
}

$temporaryRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("d2rmm-d2rloader-" + [guid]::NewGuid().ToString('N'))
$archivePath = Join-Path $temporaryRoot 'd2rmm.zip'
$extractRoot = Join-Path $temporaryRoot 'extract'
New-Item -ItemType Directory -Path $temporaryRoot, $extractRoot | Out-Null

try {
    Invoke-WebRequest -Uri $release.Uri -OutFile $archivePath
    $actualHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash
    if ($actualHash -ne $release.Sha256) {
        throw "D2RMM archive SHA-256 mismatch. Expected $($release.Sha256), got $actualHash."
    }

    Expand-Archive -LiteralPath $archivePath -DestinationPath $extractRoot
    $extracted = Join-Path $extractRoot "D2RMM Custom $($release.Version)"
    if (-not (Test-Path -LiteralPath (Join-Path $extracted 'D2RMM Custom.exe') -PathType Leaf)) {
        throw 'The verified archive does not contain the expected D2RMM executable.'
    }

    Move-Item -LiteralPath $extracted -Destination $destination

    $legacyMods = Join-Path $LegacyD2RMMRoot 'mods'
    $destinationMods = Join-Path $destination 'mods'
    if (Test-Path -LiteralPath $legacyMods -PathType Container) {
        Get-ChildItem -LiteralPath $legacyMods -Directory -Force | ForEach-Object {
            $targetMod = Join-Path $destinationMods $_.Name
            if (Test-Path -LiteralPath $targetMod) {
                throw "Refusing to replace an existing D2RMM mod: $targetMod"
            }
            Copy-Item -LiteralPath $_.FullName -Destination $targetMod -Recurse
        }
    }
}
finally {
    if (Test-Path -LiteralPath $temporaryRoot) {
        Remove-Item -LiteralPath $temporaryRoot -Recurse -Force
    }
}

Write-Output "Installed D2RMM Custom $($release.Version) at $destination"
Write-Output "Pinned upstream commit: $($release.Commit)"
Write-Output 'The legacy D2RMM installation was preserved.'
Write-Output 'In D2RMM Settings, use output mod BKVince and enable Use D2RLoader before Install Mods.'
