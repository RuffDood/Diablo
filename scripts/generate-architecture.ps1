[CmdletBinding()]
param(
    [string]$Root,
    [string]$Output
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Dossiers exclus du cadastre (bruit / non versionne / genere)
$script:excludedDirectories = @('.git', 'node_modules', 'guide', 'dist', '.turbo', '.netlify', 'analysis-cache', '__pycache__')

# Sous-arbres locaux dont seule une branche gouvernée doit entrer au cadastre.
# Les ancêtres du sous-arbre sont conservés afin que l'arbre reste navigable.
$script:selectiveWorkspaceSubtrees = @(
    'data-vanilla3.2/data/data/global/excel'
)
$script:includedWorkspacePaths = $null

if ([string]::IsNullOrWhiteSpace($Root)) {
    $Root = Split-Path -Parent $PSScriptRoot
}

$rootPath = [System.IO.Path]::GetFullPath($Root).TrimEnd('\', '/')

if (-not (Test-Path -LiteralPath $rootPath -PathType Container)) {
    throw "Workspace root not found: $rootPath"
}

if ([string]::IsNullOrWhiteSpace($Output)) {
    $Output = Join-Path $rootPath 'ai-cartographie.json'
}

$outputPath = [System.IO.Path]::GetFullPath($Output)
$rootPrefix = $rootPath + [System.IO.Path]::DirectorySeparatorChar

if (-not $outputPath.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'The architecture output must be located inside the workspace root.'
}

$existingNodes = @{}
$existingDocumentExtensions = $null

function Import-ExistingNodeData {
    param([Parameter(Mandatory)]$Node)

    $pathProperty = $Node.PSObject.Properties['path']
    if ($null -eq $pathProperty) {
        return
    }

    $existingNodes[[string]$pathProperty.Value] = $Node
    $childrenProperty = $Node.PSObject.Properties['children']

    if ($null -ne $childrenProperty -and $null -ne $childrenProperty.Value) {
        foreach ($child in $childrenProperty.Value) {
            Import-ExistingNodeData -Node $child
        }
    }
}

if (Test-Path -LiteralPath $outputPath -PathType Leaf) {
    $existingJson = Get-Content -Raw -LiteralPath $outputPath -Encoding utf8

    if (-not [string]::IsNullOrWhiteSpace($existingJson)) {
        try {
            $existingDocument = $existingJson | ConvertFrom-Json
            Import-ExistingNodeData -Node $existingDocument.root

            if ($null -ne $existingDocument.PSObject.Properties['extensions']) {
                $existingDocumentExtensions = $existingDocument.extensions
            }
        }
        catch {
            throw "Existing architecture file is not valid JSON; refusing to overwrite it: $outputPath"
        }
    }
}

# Ensure the generated manifest can describe itself.
if (-not (Test-Path -LiteralPath $outputPath)) {
    [System.IO.File]::WriteAllText(
        $outputPath,
        '',
        [System.Text.UTF8Encoding]::new($false)
    )
}

$script:directoryCount = 0
$script:fileCount = 0
$script:symlinkCount = 0

function Get-RelativeWorkspacePath {
    param([Parameter(Mandatory)][string]$FullName)

    if ($FullName.Equals($rootPath, [System.StringComparison]::OrdinalIgnoreCase)) {
        return '.'
    }

    return $FullName.Substring($rootPath.Length).TrimStart([char[]]'\/').Replace('\', '/')
}

function Initialize-IncludedWorkspacePaths {
    $gitRoot = & git -C $rootPath rev-parse --show-toplevel 2>$null
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($gitRoot)) {
        return
    }

    $resolvedGitRoot = [System.IO.Path]::GetFullPath(([string]$gitRoot).Trim()).TrimEnd('\', '/')
    if (-not $resolvedGitRoot.Equals($rootPath, [System.StringComparison]::OrdinalIgnoreCase)) {
        return
    }

    $included = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
    [void]$included.Add('.')
    $repositoryFiles = & git -c core.quotepath=false -C $rootPath ls-files --cached --others --exclude-standard
    if ($LASTEXITCODE -ne 0) {
        throw 'Unable to inventory versioned and pending repository files.'
    }

    foreach ($repositoryFile in $repositoryFiles) {
        $relativePath = ([string]$repositoryFile).Replace('\', '/').Trim('/')
        if ([string]::IsNullOrWhiteSpace($relativePath)) {
            continue
        }

        [void]$included.Add($relativePath)
        $parent = [System.IO.Path]::GetDirectoryName($relativePath.Replace('/', [System.IO.Path]::DirectorySeparatorChar))
        while (-not [string]::IsNullOrWhiteSpace($parent)) {
            $normalizedParent = $parent.Replace('\', '/')
            [void]$included.Add($normalizedParent)
            $parent = [System.IO.Path]::GetDirectoryName($parent)
        }
    }

    $outputRelativePath = Get-RelativeWorkspacePath -FullName $outputPath
    [void]$included.Add($outputRelativePath)
    $script:includedWorkspacePaths = $included
}

function Add-PreservedNodeData {
    param(
        [Parameter(Mandatory)][System.Collections.Specialized.OrderedDictionary]$Node,
        [Parameter(Mandatory)][string]$Path
    )

    if (-not $existingNodes.ContainsKey($Path)) {
        return
    }

    $existingNode = $existingNodes[$Path]

    if ($null -ne $existingNode.PSObject.Properties['meta']) {
        $Node['meta'] = $existingNode.meta
    }

    if ($null -ne $existingNode.PSObject.Properties['extensions']) {
        $Node['extensions'] = $existingNode.extensions
    }
}

function Test-ArchitectureItemExcluded {
    param([Parameter(Mandatory)][System.IO.FileSystemInfo]$Item)

    if ($Item.PSIsContainer -and $script:excludedDirectories -contains $Item.Name) {
        return $true
    }

    $relativePath = Get-RelativeWorkspacePath -FullName $Item.FullName
    if ($null -ne $script:includedWorkspacePaths -and -not $script:includedWorkspacePaths.Contains($relativePath)) {
        return $true
    }

    foreach ($subtree in $script:selectiveWorkspaceSubtrees) {
        $scopeRoot = ($subtree -split '/')[0]
        $insideScope = $relativePath -eq $scopeRoot -or $relativePath.StartsWith($scopeRoot + '/', [System.StringComparison]::OrdinalIgnoreCase)
        if (-not $insideScope) {
            continue
        }

        $isSubtree = $relativePath -eq $subtree -or $relativePath.StartsWith($subtree + '/', [System.StringComparison]::OrdinalIgnoreCase)
        $isAncestor = $subtree.StartsWith($relativePath + '/', [System.StringComparison]::OrdinalIgnoreCase)
        return -not ($isSubtree -or $isAncestor)
    }

    return $false
}

function Convert-ToArchitectureNode {
    param([Parameter(Mandatory)][System.IO.FileSystemInfo]$Item)

    $relativePath = Get-RelativeWorkspacePath -FullName $Item.FullName
    $isSymlink = ($Item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0

    if ($isSymlink) {
        $script:symlinkCount++
        $targetProperty = $Item.PSObject.Properties['Target']
        $target = if ($null -ne $targetProperty -and $null -ne $targetProperty.Value) {
            [string]($targetProperty.Value -join ';')
        }
        else {
            '<unresolved>'
        }

        $node = [ordered]@{
            name   = $Item.Name
            path   = $relativePath
            kind   = 'symlink'
            target = $target
        }
        Add-PreservedNodeData -Node $node -Path $relativePath
        return $node
    }

    if ($Item.PSIsContainer) {
        $script:directoryCount++
        $children = @(
            Get-ChildItem -LiteralPath $Item.FullName -Force |
                Where-Object { -not (Test-ArchitectureItemExcluded -Item $_) } |
                Sort-Object `
                    @{ Expression = { if ($_.PSIsContainer) { 0 } else { 1 } } },
                    @{ Expression = { $_.Name } } |
                ForEach-Object { Convert-ToArchitectureNode -Item $_ }
        )

        $node = [ordered]@{
            name = $Item.Name
            path = $relativePath
            kind = 'directory'
        }
        Add-PreservedNodeData -Node $node -Path $relativePath
        $node['children'] = $children
        return $node
    }

    $script:fileCount++
    $node = [ordered]@{
        name = $Item.Name
        path = $relativePath
        kind = 'file'
    }
    Add-PreservedNodeData -Node $node -Path $relativePath
    return $node
}

Initialize-IncludedWorkspacePaths

$rootItem = Get-Item -LiteralPath $rootPath -Force
$document = [ordered]@{
    schemaVersion = '1.1.0'
    generatedAt   = [System.DateTimeOffset]::UtcNow.ToString('o')
    root          = Convert-ToArchitectureNode -Item $rootItem
}

if ($null -ne $existingDocumentExtensions) {
    $document['extensions'] = $existingDocumentExtensions
}

$json = ($document | ConvertTo-Json -Depth 100).Replace("`r`n", "`n")
[System.IO.File]::WriteAllText(
    $outputPath,
    $json + "`n",
    [System.Text.UTF8Encoding]::new($false)
)

[pscustomobject]@{
    Output      = $outputPath
    Directories = $script:directoryCount
    Files       = $script:fileCount
    Symlinks    = $script:symlinkCount
}
