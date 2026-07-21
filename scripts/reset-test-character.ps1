[CmdletBinding()]
param(
    [string]$CharacterName = 'DummyTester',
    [string]$SaveRoot = (Join-Path ([Environment]::GetFolderPath('UserProfile')) 'Saved Games\Diablo II Resurrected'),
    [string]$ModSavePath = 'mods\BKDiablo'
)

$ErrorActionPreference = 'Stop'

function Get-D2SInfo {
    param([Parameter(Mandatory)][string]$Path)

    $bytes = [System.IO.File]::ReadAllBytes($Path)
    if ($bytes.Length -lt 16) {
        throw "D2S file is too short: $Path"
    }

    $magic = [System.BitConverter]::ToString($bytes, 0, 4)
    if ($magic -ne '55-AA-55-AA') {
        throw "Invalid D2S signature in: $Path"
    }

    $declaredSize = [System.BitConverter]::ToUInt32($bytes, 8)
    if ($declaredSize -ne $bytes.Length) {
        throw "D2S size mismatch in ${Path}: declared $declaredSize, actual $($bytes.Length)"
    }

    $storedChecksum = [System.BitConverter]::ToUInt32($bytes, 12)
    [uint32]$computedChecksum = 0
    for ($index = 0; $index -lt $bytes.Length; $index++) {
        $value = if ($index -ge 12 -and $index -lt 16) { 0 } else { $bytes[$index] }
        $carry = ($computedChecksum -band 0x80000000) -ne 0
        $computedChecksum = [uint32](($computedChecksum -shl 1) -band 0xFFFFFFFF)
        if ($carry) {
            $computedChecksum = [uint32]($computedChecksum + 1)
        }
        $computedChecksum = [uint32](($computedChecksum + $value) -band 0xFFFFFFFF)
    }

    if ($storedChecksum -ne $computedChecksum) {
        throw ('Invalid D2S checksum in {0}: stored 0x{1:X8}, computed 0x{2:X8}' -f $Path, $storedChecksum, $computedChecksum)
    }

    [pscustomobject]@{
        Version = [System.BitConverter]::ToUInt32($bytes, 4)
        Size = $bytes.Length
        Checksum = ('0x{0:X8}' -f $storedChecksum)
        SHA256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash
    }
}

$masterPath = Join-Path (Join-Path $SaveRoot 'Test Masters') "$CharacterName.d2s"
$runtimeDirectory = Join-Path $SaveRoot $ModSavePath
$runtimePath = Join-Path $runtimeDirectory "$CharacterName.d2s"

if (-not (Test-Path -LiteralPath $masterPath -PathType Leaf)) {
    throw "Master character is missing: $masterPath"
}
if (-not (Test-Path -LiteralPath $runtimeDirectory -PathType Container)) {
    throw "BKVince save directory is missing: $runtimeDirectory"
}

$masterInfo = Get-D2SInfo -Path $masterPath

$processNames = @('D2R', 'D2RLoader', 'D2RLauncher', 'Diablo II Resurrected Launcher')
$runningProcesses = @(Get-Process -Name $processNames -ErrorAction SilentlyContinue)
if ($runningProcesses.Count -gt 0) {
    $runningProcesses | Stop-Process -Force
    $runningProcesses | Wait-Process -Timeout 15 -ErrorAction SilentlyContinue
}

$temporaryPath = Join-Path $runtimeDirectory ".$CharacterName.reset-$([guid]::NewGuid().ToString('N')).tmp"
try {
    Copy-Item -LiteralPath $masterPath -Destination $temporaryPath
    $temporaryInfo = Get-D2SInfo -Path $temporaryPath
    if ($temporaryInfo.SHA256 -ne $masterInfo.SHA256) {
        throw 'Temporary runtime copy does not match the master character.'
    }

    Move-Item -LiteralPath $temporaryPath -Destination $runtimePath -Force
}
finally {
    if (Test-Path -LiteralPath $temporaryPath) {
        Remove-Item -LiteralPath $temporaryPath -Force
    }
}

$runtimeInfo = Get-D2SInfo -Path $runtimePath
if ($runtimeInfo.SHA256 -ne $masterInfo.SHA256) {
    throw 'Runtime character does not match the master after reset.'
}

Write-Output 'RESET PERSONNAGE: VALID'
Write-Output "Master:  $masterPath"
Write-Output "Runtime: $runtimePath"
Write-Output "D2S:     version $($runtimeInfo.Version), $($runtimeInfo.Size) bytes, checksum $($runtimeInfo.Checksum)"
Write-Output "SHA256:  $($runtimeInfo.SHA256)"
Write-Output 'Shared stash files and other characters were not modified.'
