[CmdletBinding()]
param(
    [ValidateSet('Debug', 'Release', 'RelWithDebInfo', 'MinSizeRel')]
    [string]$Configuration = 'Release',
    [string[]]$Project = @(),
    [switch]$Clean,
    [switch]$SkipTests,
    [ValidateRange(1, 256)]
    [int]$Parallel = [Environment]::ProcessorCount
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-VsWherePath {
    $candidates = @(
        (Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'),
        (Join-Path $env:ProgramFiles 'Microsoft Visual Studio\Installer\vswhere.exe')
    )

    $path = $candidates |
        Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } |
        Select-Object -First 1

    if ([string]::IsNullOrWhiteSpace($path)) {
        throw 'vswhere.exe was not found. Install Visual Studio 2022 Build Tools with the MSVC x64 component.'
    }

    return $path
}

function Get-VsToolPath {
    param(
        [Parameter(Mandatory)]
        [string]$VsWhere,
        [Parameter(Mandatory)]
        [string]$Pattern
    )

    $path = & $VsWhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -find $Pattern |
        Select-Object -First 1
    if ([string]::IsNullOrWhiteSpace($path) -or -not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "Visual Studio tool not found through vswhere: $Pattern"
    }

    return [IO.Path]::GetFullPath($path)
}

function Import-MsvcEnvironment {
    param(
        [Parameter(Mandatory)]
        [string]$VcVarsPath
    )

    $commandLine = "`"$VcVarsPath`" >nul && set"
    $environmentLines = & $env:ComSpec /d /s /c $commandLine
    if ($LASTEXITCODE -ne 0) {
        throw "MSVC environment initialization failed with exit code $LASTEXITCODE."
    }

    foreach ($line in $environmentLines) {
        if ($line -match '^([^=]+)=(.*)$') {
            [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2], 'Process')
        }
    }
}

function Invoke-Checked {
    param(
        [Parameter(Mandatory)]
        [string]$FilePath,
        [Parameter(Mandatory)]
        [string[]]$Arguments,
        [Parameter(Mandatory)]
        [string]$Description
    )

    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Description failed with exit code $LASTEXITCODE."
    }
}

function Get-NativeProjects {
    param(
        [Parameter(Mandatory)]
        [string]$RepositoryRoot
    )

    $sourceDirectories = @()
    $pluginRoot = Join-Path $RepositoryRoot 'data-BKVince\d2rloader\plugins'
    if (Test-Path -LiteralPath $pluginRoot -PathType Container) {
        $sourceDirectories += Get-ChildItem -LiteralPath $pluginRoot -Directory -Filter '*-src' |
            Select-Object -ExpandProperty FullName
    }

    $addonsRoot = Join-Path $RepositoryRoot 'addons'
    if (Test-Path -LiteralPath $addonsRoot -PathType Container) {
        $sourceDirectories += Get-ChildItem -LiteralPath $addonsRoot -Directory |
            ForEach-Object { Join-Path $_.FullName 'src' } |
            Where-Object { Test-Path -LiteralPath (Join-Path $_ 'CMakeLists.txt') -PathType Leaf }
    }

    $projects = foreach ($sourceDirectory in ($sourceDirectories | Sort-Object -Unique)) {
        $cmakeList = Join-Path $sourceDirectory 'CMakeLists.txt'
        if (-not (Test-Path -LiteralPath $cmakeList -PathType Leaf)) {
            continue
        }

        $content = Get-Content -LiteralPath $cmakeList -Raw -Encoding UTF8
        $match = [regex]::Match($content, '(?im)^\s*project\s*\(\s*([A-Za-z0-9_.+-]+)')
        if (-not $match.Success) {
            throw "Unable to determine the CMake project name from $cmakeList"
        }

        [pscustomobject]@{
            Name = $match.Groups[1].Value
            Source = [IO.Path]::GetFullPath($sourceDirectory)
        }
    }

    $duplicates = $projects | Group-Object Name | Where-Object Count -gt 1
    if ($duplicates) {
        throw "Duplicate native project names: $(($duplicates.Name | Sort-Object) -join ', ')"
    }

    return @($projects | Sort-Object Name)
}

$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$buildRoot = [IO.Path]::GetFullPath((Join-Path $repoRoot 'analysis-cache\native-build'))
$vswhere = Get-VsWherePath
$vcVars = Get-VsToolPath -VsWhere $vswhere -Pattern 'VC\Auxiliary\Build\vcvars64.bat'
$cmake = Get-VsToolPath -VsWhere $vswhere -Pattern 'Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe'
$ninja = Get-VsToolPath -VsWhere $vswhere -Pattern 'Common7\IDE\CommonExtensions\Microsoft\CMake\Ninja\ninja.exe'
$vsVersion = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationVersion |
    Select-Object -First 1

Import-MsvcEnvironment -VcVarsPath $vcVars
$env:CMAKE_GENERATOR = 'Ninja'
$env:CMAKE_MAKE_PROGRAM = $ninja

$cl = Get-Command 'cl.exe' -ErrorAction SilentlyContinue
if ($null -eq $cl) {
    throw 'cl.exe is still unavailable after importing vcvars64.bat.'
}

$projects = Get-NativeProjects -RepositoryRoot $repoRoot
$isFullBuild = $Project.Count -eq 0
if ($Project.Count -gt 0) {
    $requested = @(
        $Project |
            ForEach-Object { $_ -split ',' } |
            ForEach-Object { $_.Trim() } |
            Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
            Sort-Object -Unique
    )
    $knownNames = @($projects.Name)
    $unknown = @($requested | Where-Object { $_ -notin $knownNames })
    if ($unknown.Count -gt 0) {
        throw "Unknown native project(s): $($unknown -join ', '). Known projects: $($knownNames -join ', ')"
    }
    $projects = @($projects | Where-Object Name -in $requested)
}

if ($projects.Count -eq 0) {
    throw 'No native CMake project was found.'
}

New-Item -ItemType Directory -Path $buildRoot -Force | Out-Null
$runtimeLibrary = if ($Configuration -eq 'Debug') { 'MultiThreadedDebugDLL' } else { 'MultiThreadedDLL' }
$results = @()

Write-Output "visualStudio=$vsVersion"
Write-Output "cl=$($cl.Source)"
Write-Output "cmake=$cmake"
Write-Output "ninja=$ninja"
Write-Output "configuration=$Configuration projects=$($projects.Count) parallel=$Parallel"

foreach ($nativeProject in $projects) {
    $buildDirectory = [IO.Path]::GetFullPath((Join-Path $buildRoot "$($nativeProject.Name)\$Configuration"))
    if (-not $buildDirectory.StartsWith($buildRoot + '\', [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing build directory outside the governed cache: $buildDirectory"
    }

    if ($Clean -and (Test-Path -LiteralPath $buildDirectory)) {
        Remove-Item -LiteralPath $buildDirectory -Recurse -Force
    }
    New-Item -ItemType Directory -Path $buildDirectory -Force | Out-Null

    Write-Output "configure=$($nativeProject.Name) source=$($nativeProject.Source)"
    $configureArguments = @(
        '-S', $nativeProject.Source,
        '-B', $buildDirectory,
        '-G', 'Ninja',
        "-DCMAKE_MAKE_PROGRAM=$ninja",
        "-DCMAKE_BUILD_TYPE=$Configuration",
        "-DCMAKE_MSVC_RUNTIME_LIBRARY=$runtimeLibrary",
        '-DCMAKE_SHARED_LINKER_FLAGS=/Brepro',
        '-DCMAKE_EXE_LINKER_FLAGS=/Brepro',
        '-DCMAKE_EXPORT_COMPILE_COMMANDS=ON',
        '-DFETCHCONTENT_UPDATES_DISCONNECTED=ON'
    )
    Invoke-Checked -FilePath $cmake -Arguments $configureArguments -Description "CMake configure for $($nativeProject.Name)"

    Write-Output "build=$($nativeProject.Name)"
    Invoke-Checked -FilePath $cmake -Arguments @(
        '--build', $buildDirectory,
        '--config', $Configuration,
        '--parallel', $Parallel.ToString()
    ) -Description "Native build for $($nativeProject.Name)"

    $testFile = Join-Path $buildDirectory 'CTestTestfile.cmake'
    if (-not $SkipTests -and (Test-Path -LiteralPath $testFile -PathType Leaf)) {
        Write-Output "test=$($nativeProject.Name)"
        Invoke-Checked -FilePath $cmake -Arguments @(
            '--build', $buildDirectory,
            '--config', $Configuration,
            '--target', 'test'
        ) -Description "Native tests for $($nativeProject.Name)"
    }

    $artifact = Get-ChildItem -LiteralPath $buildDirectory -Recurse -File -Filter "$($nativeProject.Name).dll" |
        Where-Object { $_.FullName -notmatch '[\\/]_deps[\\/]' } |
        Select-Object -First 1
    if ($null -eq $artifact) {
        throw "Expected DLL was not produced for $($nativeProject.Name)."
    }

    $hash = (Get-FileHash -LiteralPath $artifact.FullName -Algorithm SHA256).Hash
    $results += [pscustomobject]@{
        name = $nativeProject.Name
        source = $nativeProject.Source.Substring($repoRoot.Length + 1).Replace('\', '/')
        artifact = $artifact.FullName
        sha256 = $hash
    }
    Write-Output "artifact=$($artifact.FullName) sha256=$hash"
}

$manifest = [ordered]@{
    schemaVersion = 1
    generatedAtUtc = [DateTime]::UtcNow.ToString('o')
    configuration = $Configuration
    visualStudio = $vsVersion
    cmake = (& $cmake --version | Select-Object -First 1)
    ninja = (& $ninja --version | Select-Object -First 1)
    projects = $results
}
$manifestFileName = if ($isFullBuild) {
    'build-manifest.json'
}
else {
    $scope = (($results.name -join '-') -replace '[^A-Za-z0-9_.-]', '_')
    "build-manifest.$Configuration.$scope.json"
}
$manifestPath = Join-Path $buildRoot $manifestFileName
$manifestJson = $manifest | ConvertTo-Json -Depth 5
[IO.File]::WriteAllText($manifestPath, $manifestJson + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))

Write-Output "manifest=$manifestPath"
Write-Output "nativeBuild=PASS projects=$($results.Count)"
