<#
.SYNOPSIS
  Move ficheiros de video de subpastas para a raiz indicada.
.DESCRIPTION
  Percorre recursivamente -Root, ignora pastas conhecidas (trailers, preview, .thumb_cache, incoming, node_modules, .git),
  e move cada video que esteja numa subpasta para a propria raiz. Se o nome ja existir na raiz,
  nao substitui: usa 1_nome.ext, 2_nome.ext, etc.
.PARAMETER Root
  Pasta raiz (default: diretorio atual).
.PARAMETER WhatIf
  Apenas lista o que faria, sem mover.
.PARAMETER ExcludeDirNames
  Nomes de pasta (qualquer segmento no caminho) onde nao se procura nem se move de.
#>
param(
    [string]$Root = (Get-Location).Path,
    [switch]$WhatIf,
    [string[]]$ExcludeDirNames = @('trailers', 'preview', '.thumb_cache', 'incoming', 'node_modules', '.git', '.nuxt', 'dist', 'output')
)

$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path -LiteralPath $Root).Path.TrimEnd('\')

# Sem ".ts" aqui: em projectos de codigo ".ts" e TypeScript, nao MPEG-TS.
$videoExt = @(
    '.mp4', '.mkv', '.avi', '.mov', '.webm', '.m4v', '.wmv', '.flv',
    '.mpeg', '.mpg', '.m2ts', '.mts', '.3gp'
)
$extSet = @{}
foreach ($e in $videoExt) { $extSet[$e.ToLowerInvariant()] = $true }

$excluded = @{}
foreach ($n in $ExcludeDirNames) { $excluded[$n.ToLowerInvariant()] = $true }

function Test-AnyPathSegmentExcluded {
    param([string]$FullPath, [string]$RootNorm)
    $rel = $FullPath.Substring($RootNorm.Length).TrimStart('\')
    if (-not $rel) { return $false }
    foreach ($seg in $rel.Split([char[]]@('\', '/'))) {
        if ($seg -and $script:excluded.ContainsKey($seg.ToLowerInvariant())) { return $true }
    }
    return $false
}

function Get-UniqueDestPath {
    param(
        [string]$DestDir,
        [string]$FileName
    )
    $dest = Join-Path $DestDir $FileName
    if (-not (Test-Path -LiteralPath $dest)) { return $dest }
    $stem = [System.IO.Path]::GetFileNameWithoutExtension($FileName)
    $ext = [System.IO.Path]::GetExtension($FileName)
    $n = 1
    while ($true) {
        $candidate = Join-Path $DestDir "${n}_${stem}${ext}"
        if (-not (Test-Path -LiteralPath $candidate)) { return $candidate }
        $n++
    }
}

$files = Get-ChildItem -LiteralPath $Root -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object {
        $extSet.ContainsKey($_.Extension.ToLowerInvariant()) -and
        $_.DirectoryName -ne $Root -and
        -not (Test-AnyPathSegmentExcluded -FullPath $_.FullName -RootNorm $Root)
    } |
    Sort-Object { $_.FullName.Length } -Descending

$moved = 0
$skipped = 0

foreach ($f in $files) {
    $dest = Get-UniqueDestPath -DestDir $Root -FileName $f.Name
    $relFrom = $f.FullName.Substring($Root.Length).TrimStart('\')
    if ($WhatIf) {
        $destName = [IO.Path]::GetFileName($dest)
        Write-Host "[WhatIf] $relFrom  -->  $destName"
        continue
    }
    try {
        Move-Item -LiteralPath $f.FullName -Destination $dest -ErrorAction Stop
        Write-Host "OK  $relFrom -> $([IO.Path]::GetFileName($dest))"
        $moved++
    }
    catch {
        Write-Warning "Falhou: $($f.FullName) - $($_.Exception.Message)"
        $skipped++
    }
}

if ($WhatIf) {
    Write-Host ""
    Write-Host ('WhatIf: {0} ficheiros seriam movidos. Corra sem -WhatIf para aplicar.' -f $files.Count)
}
else {
    Write-Host ""
    Write-Host ('Feito: {0} movidos, {1} falhas, {2} candidatos.' -f $moved, $skipped, $files.Count)
}
