#requires -Version 5.1

<#
.SYNOPSIS
Publie la branche main vers GitHub et vers le dossier actif du mod TCP.

.DESCRIPTION
Ce script ne change jamais de branche et ne cree aucun commit. Il exige que la
branche courante soit main et que data-TCP ne contienne aucun changement local.

Avant de modifier le dossier actif, il compare tous les fichiers par SHA-256,
sauvegarde les fichiers qui seront remplaces ou supprimes, pousse main vers
origin/main, synchronise le contenu, puis verifie le resultat.

.EXAMPLE
.\scripts\publish-tcp.ps1

.EXAMPLE
.\scripts\publish-tcp.ps1 -WhatIf
#>

[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'High')]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-NormalizedPath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    return ([System.IO.Path]::GetFullPath($Path)).TrimEnd([char[]]'\/')
}

function Test-SamePath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Left,

        [Parameter(Mandatory = $true)]
        [string]$Right
    )

    return [string]::Equals(
        (Get-NormalizedPath -Path $Left),
        (Get-NormalizedPath -Path $Right),
        [System.StringComparison]::OrdinalIgnoreCase
    )
}

function Invoke-Git {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments,

        [switch]$Capture
    )

    # Windows PowerShell 5 transforme parfois le canal stderr de Git en erreur
    # PowerShell, meme lorsque Git termine correctement (par exemple git fetch).
    $previousErrorActionPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $output = & git -C $script:RepositoryRoot @Arguments 2>&1
        $exitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }

    if ($exitCode -ne 0) {
        $details = ($output | ForEach-Object { $_.ToString() }) -join [Environment]::NewLine
        throw "Echec Git: git $($Arguments -join ' ')`n$details"
    }

    if ($Capture) {
        return (($output | ForEach-Object { $_.ToString() }) -join "`n").Trim()
    }

    foreach ($line in $output) {
        Write-Host $line
    }
}

function Assert-NoGitOperationInProgress {
    $gitDirectory = Invoke-Git -Arguments @('rev-parse', '--git-dir') -Capture
    if (-not [System.IO.Path]::IsPathRooted($gitDirectory)) {
        $gitDirectory = Join-Path $script:RepositoryRoot $gitDirectory
    }

    $markers = @(
        'MERGE_HEAD',
        'CHERRY_PICK_HEAD',
        'REVERT_HEAD',
        'rebase-apply',
        'rebase-merge'
    )

    foreach ($marker in $markers) {
        if (Test-Path -LiteralPath (Join-Path $gitDirectory $marker)) {
            throw "Une operation Git est en cours ($marker). Termine-la avant de publier."
        }
    }
}

function Assert-SafeDirectory {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,

        [Parameter(Mandatory = $true)]
        [string]$ExpectedPath,

        [Parameter(Mandatory = $true)]
        [string]$Label
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
        throw "$Label introuvable: $Path"
    }

    if (-not (Test-SamePath -Left $Path -Right $ExpectedPath)) {
        throw "$Label inattendu. Attendu: $ExpectedPath Recu: $Path"
    }

    $item = Get-Item -LiteralPath $Path -Force
    if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "$Label refuse: le dossier racine est un lien ou une jonction."
    }

    $nestedLink = Get-ChildItem -LiteralPath $Path -Recurse -Force -ErrorAction Stop |
        Where-Object { ($_.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0 } |
        Select-Object -First 1

    if ($null -ne $nestedLink) {
        throw "$Label refuse: lien ou jonction detecte: $($nestedLink.FullName)"
    }

    foreach ($requiredDirectory in @('D2RLAN', 'global', 'hd', 'local')) {
        $requiredPath = Join-Path $Path $requiredDirectory
        if (-not (Test-Path -LiteralPath $requiredPath -PathType Container)) {
            throw "$Label invalide: dossier requis absent: $requiredDirectory"
        }
    }
}

function Get-FileMap {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Root
    )

    $normalizedRoot = Get-NormalizedPath -Path $Root
    $prefix = $normalizedRoot + [System.IO.Path]::DirectorySeparatorChar
    $map = [System.Collections.Generic.Dictionary[string, System.IO.FileInfo]]::new(
        [System.StringComparer]::OrdinalIgnoreCase
    )

    foreach ($file in Get-ChildItem -LiteralPath $normalizedRoot -Recurse -File -Force -ErrorAction Stop) {
        $relativePath = $file.FullName.Substring($prefix.Length)

        if ($map.ContainsKey($relativePath)) {
            throw "Deux fichiers utilisent le meme chemin relatif: $relativePath"
        }

        $map.Add($relativePath, $file)
    }

    return $map
}

function Get-Sha256 {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    # Calcul .NET en lecture seule, independant de la preference PowerShell
    # -WhatIf afin que la simulation puisse quand meme comparer les fichiers.
    $stream = $null
    $sha256 = $null
    try {
        $stream = [System.IO.File]::OpenRead($Path)
        $sha256 = [System.Security.Cryptography.SHA256]::Create()
        $hashBytes = $sha256.ComputeHash($stream)
    }
    finally {
        if ($null -ne $sha256) {
            $sha256.Dispose()
        }

        if ($null -ne $stream) {
            $stream.Dispose()
        }
    }

    return ([System.BitConverter]::ToString($hashBytes)).Replace('-', '').ToLowerInvariant()
}

function Compare-DirectoryContent {
    param(
        [Parameter(Mandatory = $true)]
        [string]$SourceRoot,

        [Parameter(Mandatory = $true)]
        [string]$TargetRoot
    )

    $sourceMap = Get-FileMap -Root $SourceRoot
    $targetMap = Get-FileMap -Root $TargetRoot
    $changes = [System.Collections.Generic.List[object]]::new()
    $identicalCount = 0

    foreach ($relativePath in ($sourceMap.Keys | Sort-Object)) {
        $sourceFile = $sourceMap[$relativePath]

        if (-not $targetMap.ContainsKey($relativePath)) {
            $changes.Add([pscustomobject][ordered]@{
                Action       = 'Add'
                RelativePath = $relativePath
                SourceSize   = $sourceFile.Length
                TargetSize   = $null
                SourceHash   = Get-Sha256 -Path $sourceFile.FullName
                TargetHash   = $null
            })
            continue
        }

        $targetFile = $targetMap[$relativePath]
        $sourceHash = Get-Sha256 -Path $sourceFile.FullName
        $targetHash = Get-Sha256 -Path $targetFile.FullName

        if ($sourceHash -eq $targetHash) {
            $identicalCount++
            continue
        }

        $changes.Add([pscustomobject][ordered]@{
            Action       = 'Replace'
            RelativePath = $relativePath
            SourceSize   = $sourceFile.Length
            TargetSize   = $targetFile.Length
            SourceHash   = $sourceHash
            TargetHash   = $targetHash
        })
    }

    foreach ($relativePath in ($targetMap.Keys | Sort-Object)) {
        if ($sourceMap.ContainsKey($relativePath)) {
            continue
        }

        $targetFile = $targetMap[$relativePath]
        $changes.Add([pscustomobject][ordered]@{
            Action       = 'Delete'
            RelativePath = $relativePath
            SourceSize   = $null
            TargetSize   = $targetFile.Length
            SourceHash   = $null
            TargetHash   = Get-Sha256 -Path $targetFile.FullName
        })
    }

    return [pscustomobject]@{
        SourceCount   = $sourceMap.Count
        TargetCount   = $targetMap.Count
        IdenticalCount = $identicalCount
        Changes       = @($changes)
    }
}

function New-DeltaBackup {
    param(
        [Parameter(Mandatory = $true)]
        [object[]]$Changes,

        [Parameter(Mandatory = $true)]
        [string]$TargetRoot,

        [Parameter(Mandatory = $true)]
        [string]$BackupDirectory
    )

    $backupDataRoot = Join-Path $BackupDirectory 'data'
    New-Item -ItemType Directory -Path $backupDataRoot -Force | Out-Null

    foreach ($change in $Changes) {
        if ($change.Action -notin @('Replace', 'Delete')) {
            continue
        }

        $activePath = Join-Path $TargetRoot $change.RelativePath
        $backupPath = Join-Path $backupDataRoot $change.RelativePath
        $backupParent = Split-Path -Parent $backupPath
        New-Item -ItemType Directory -Path $backupParent -Force | Out-Null
        Copy-Item -LiteralPath $activePath -Destination $backupPath -Force
    }
}

$script:RepositoryRoot = Get-NormalizedPath -Path (Split-Path -Parent $PSScriptRoot)
$expectedRepositoryRoot = Get-NormalizedPath -Path 'C:\Workspaces\Diablo'
$sourceRoot = Get-NormalizedPath -Path (Join-Path $script:RepositoryRoot 'data-TCP')
$expectedSourceRoot = Get-NormalizedPath -Path 'C:\Workspaces\Diablo\data-TCP'
$targetRoot = Get-NormalizedPath -Path 'C:\Games\D2RLAN\D2R\Mods\TCP\TCP.mpq\data'
$expectedTargetRoot = Get-NormalizedPath -Path 'C:\Games\D2RLAN\D2R\Mods\TCP\TCP.mpq\data'
$backupRoot = Get-NormalizedPath -Path 'C:\Games\D2RLAN\D2R\Mods\TCP\_deploy-backups'
$expectedRemotePattern = '^(https://github\.com/|git@github\.com:)RuffDood/Diablo(?:\.git)?$'

if (-not (Test-SamePath -Left $script:RepositoryRoot -Right $expectedRepositoryRoot)) {
    throw "Ce script doit etre execute depuis le depot $expectedRepositoryRoot"
}

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    throw 'Git est introuvable.'
}

if (-not (Get-Command robocopy.exe -ErrorAction SilentlyContinue)) {
    throw 'Robocopy est introuvable.'
}

$detectedRepositoryRoot = Invoke-Git -Arguments @('rev-parse', '--show-toplevel') -Capture
if (-not (Test-SamePath -Left $detectedRepositoryRoot -Right $script:RepositoryRoot)) {
    throw "Le depot Git detecte est inattendu: $detectedRepositoryRoot"
}

$branch = Invoke-Git -Arguments @('branch', '--show-current') -Capture
if ($branch -ne 'main') {
    throw "Publication refusee: branche actuelle '$branch'. Passe manuellement sur main avec un GO dedie."
}

Assert-NoGitOperationInProgress

$remoteUrl = Invoke-Git -Arguments @('remote', 'get-url', 'origin') -Capture
if ($remoteUrl -notmatch $expectedRemotePattern) {
    throw "Remote origin refuse: $remoteUrl"
}

Assert-SafeDirectory -Path $sourceRoot -ExpectedPath $expectedSourceRoot -Label 'Source'
Assert-SafeDirectory -Path $targetRoot -ExpectedPath $expectedTargetRoot -Label 'Destination active'

$targetPrefix = $targetRoot + [System.IO.Path]::DirectorySeparatorChar
if ($backupRoot.StartsWith($targetPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'Le dossier de sauvegarde ne doit pas se trouver dans la destination synchronisee.'
}

$trackedStatus = Invoke-Git -Arguments @(
    'status',
    '--porcelain',
    '--untracked-files=no'
) -Capture

if (-not [string]::IsNullOrWhiteSpace($trackedStatus)) {
    throw "Le depot contient des changements suivis non enregistres:`n$trackedStatus"
}

$dataStatus = Invoke-Git -Arguments @(
    'status',
    '--porcelain',
    '--untracked-files=all',
    '--',
    'data-TCP'
) -Capture

if (-not [string]::IsNullOrWhiteSpace($dataStatus)) {
    throw "data-TCP contient des changements non enregistres:`n$dataStatus"
}

Write-Host 'Verification de origin/main...' -ForegroundColor Cyan
Invoke-Git -Arguments @('fetch', 'origin', 'main')

$countsText = Invoke-Git -Arguments @(
    'rev-list',
    '--left-right',
    '--count',
    'origin/main...main'
) -Capture
$counts = @($countsText -split '\s+' | Where-Object { $_ -ne '' })

if ($counts.Count -ne 2) {
    throw "Impossible de comparer main et origin/main: $countsText"
}

$remoteOnlyCount = [int]$counts[0]
$localOnlyCount = [int]$counts[1]

if ($remoteOnlyCount -gt 0) {
    throw "main est en retard ou divergee de origin/main. Fais d'abord: git pull --ff-only origin main"
}

$headCommit = Invoke-Git -Arguments @('rev-parse', 'HEAD') -Capture
$pendingCommits = Invoke-Git -Arguments @('log', '--oneline', 'origin/main..main') -Capture

Write-Host 'Comparaison SHA-256 du workspace et du dossier actif...' -ForegroundColor Cyan
$comparison = Compare-DirectoryContent -SourceRoot $sourceRoot -TargetRoot $targetRoot
$changes = @($comparison.Changes)
$addCount = @($changes | Where-Object { $_.Action -eq 'Add' }).Count
$replaceCount = @($changes | Where-Object { $_.Action -eq 'Replace' }).Count
$deleteCount = @($changes | Where-Object { $_.Action -eq 'Delete' }).Count

Write-Host ''
Write-Host 'Resume de publication' -ForegroundColor White
Write-Host "  Branche             : $branch"
Write-Host "  Commit              : $headCommit"
Write-Host "  Commits a pousser   : $localOnlyCount"
Write-Host "  Source              : $sourceRoot"
Write-Host "  Destination         : $targetRoot"
Write-Host "  Fichiers source     : $($comparison.SourceCount)"
Write-Host "  Fichiers actifs     : $($comparison.TargetCount)"
Write-Host "  Identiques          : $($comparison.IdenticalCount)"
Write-Host "  Ajouts              : $addCount"
Write-Host "  Remplacements       : $replaceCount"
Write-Host "  Suppressions        : $deleteCount"

if ($localOnlyCount -gt 0) {
    Write-Host ''
    Write-Host 'Commits qui seront pousses:' -ForegroundColor Yellow
    Write-Host $pendingCommits
}

if ($changes.Count -gt 0) {
    Write-Host ''
    Write-Host 'Fichiers concernes:' -ForegroundColor Yellow
    $preview = $changes | Select-Object -First 100 Action, RelativePath
    Write-Host ($preview | Format-Table -AutoSize | Out-String)

    if ($changes.Count -gt 100) {
        Write-Host "  ... et $($changes.Count - 100) autre(s) fichier(s)."
    }
}

$actionDescription = "pousser main vers GitHub puis synchroniser $($changes.Count) fichier(s) vers le mod actif"
$operationTarget = "origin/main et $targetRoot"

if (-not $PSCmdlet.ShouldProcess($operationTarget, $actionDescription)) {
    Write-Host 'Simulation terminee. Aucun fichier ni commit modifie.' -ForegroundColor Yellow
    return
}

if ($changes.Count -gt 0) {
    $runningGameProcesses = @(Get-Process -Name @('D2R', 'D2RLauncher', 'D2RLAN') -ErrorAction SilentlyContinue)
    if ($runningGameProcesses.Count -gt 0) {
        $processNames = ($runningGameProcesses | Select-Object -ExpandProperty ProcessName -Unique) -join ', '
        throw "Ferme le jeu et son lanceur avant de publier. Processus detectes: $processNames"
    }
}

$backupDirectory = $null
$manifestPath = $null
$manifest = $null

if ($changes.Count -gt 0) {
    $timestamp = Get-Date -Format 'yyyyMMdd-HHmmssfff'
    $backupDirectory = Join-Path $backupRoot $timestamp
    $manifestPath = Join-Path $backupDirectory 'manifest.json'

    Write-Host "Sauvegarde differentielle: $backupDirectory" -ForegroundColor Cyan
    New-DeltaBackup -Changes $changes -TargetRoot $targetRoot -BackupDirectory $backupDirectory

    $manifest = [ordered]@{
        version       = 1
        status        = 'backup-created'
        createdAt     = (Get-Date).ToString('o')
        completedAt   = $null
        repository    = $script:RepositoryRoot
        branch        = $branch
        commit        = $headCommit
        remote        = $remoteUrl
        source        = $sourceRoot
        target        = $targetRoot
        backup        = $backupDirectory
        sourceCount   = $comparison.SourceCount
        targetCount   = $comparison.TargetCount
        changes       = $changes
        error         = $null
    }

    $manifest | ConvertTo-Json -Depth 8 |
        Set-Content -LiteralPath $manifestPath -Encoding UTF8
}

try {
    Write-Host 'Push de main vers origin/main...' -ForegroundColor Cyan
    Invoke-Git -Arguments @('push', 'origin', 'main')

    Invoke-Git -Arguments @('fetch', 'origin', 'main')
    $localHeadAfterPush = Invoke-Git -Arguments @('rev-parse', 'HEAD') -Capture
    $remoteHeadAfterPush = Invoke-Git -Arguments @('rev-parse', 'origin/main') -Capture

    if ($localHeadAfterPush -ne $remoteHeadAfterPush) {
        throw 'Le push ne laisse pas main et origin/main sur le meme commit.'
    }

    if ($changes.Count -gt 0) {
        Write-Host 'Synchronisation vers le dossier actif...' -ForegroundColor Cyan
        $robocopyArguments = @(
            $sourceRoot,
            $targetRoot,
            '/MIR',
            '/COPY:DAT',
            '/DCOPY:DAT',
            '/R:2',
            '/W:1',
            '/XJ',
            '/NP',
            '/NFL',
            '/NDL'
        )

        $robocopyOutput = & robocopy.exe @robocopyArguments
        $robocopyExitCode = $LASTEXITCODE
        $robocopyOutput | ForEach-Object { Write-Host $_ }

        if ($robocopyExitCode -ge 8) {
            throw "Robocopy a echoue avec le code $robocopyExitCode."
        }

        Write-Host 'Verification finale SHA-256...' -ForegroundColor Cyan
        $finalComparison = Compare-DirectoryContent -SourceRoot $sourceRoot -TargetRoot $targetRoot

        if (@($finalComparison.Changes).Count -ne 0) {
            $remaining = @($finalComparison.Changes | Select-Object -First 20 Action, RelativePath)
            $remainingText = $remaining | Format-Table -AutoSize | Out-String
            throw "La destination ne correspond pas completement a la source:`n$remainingText"
        }

        $manifest['status'] = 'published'
        $manifest['completedAt'] = (Get-Date).ToString('o')
        $manifest | ConvertTo-Json -Depth 8 |
            Set-Content -LiteralPath $manifestPath -Encoding UTF8
    }

    Write-Host ''
    Write-Host 'Publication terminee avec succes.' -ForegroundColor Green
    Write-Host "  Commit publie : $localHeadAfterPush"

    if ($null -ne $backupDirectory) {
        Write-Host "  Sauvegarde    : $backupDirectory"
    }
    else {
        Write-Host '  Dossier actif : deja identique, aucune copie necessaire.'
    }
}
catch {
    if ($null -ne $manifest -and $null -ne $manifestPath) {
        $manifest['status'] = 'failed'
        $manifest['completedAt'] = (Get-Date).ToString('o')
        $manifest['error'] = $_.Exception.Message
        $manifest | ConvertTo-Json -Depth 8 |
            Set-Content -LiteralPath $manifestPath -Encoding UTF8
    }

    throw
}
