<#
.SYNOPSIS
  Move ficheiros de video de subpastas para a raiz indicada.
.DESCRIPTION
  Percorre recursivamente -Root. Por defeito ignora a pasta «trailers» (e outras conhecidas: preview, .thumb_cache, etc.);
  use -IncludeTrailers para tambem achatar ficheiros que estejam dentro de trailers/.
  Se ja existir na raiz um ficheiro com o mesmo nome, nao move nem substitui: avisa e mantem na origem.
.PARAMETER Root
  Pasta raiz (default: diretorio atual).
.PARAMETER WhatIf
  Apenas lista o que faria, sem mover.
.PARAMETER IncludeTrailers
  Inclui paths sob a pasta «trailers» no flatten. Sem este switch, «trailers» e sempre ignorada (mesmo se
  -ExcludeDirNames for personalizado sem incluir o nome trailers).
.PARAMETER ExcludeDirNames
  Lista base de nomes de pasta a ignorar. Se passar este parametro, substitui o array por defeito (use -AlsoExclude
  em vez disso se quiser so acrescentar pastas).
.PARAMETER AlsoExclude
  Nomes de pasta extra a ignorar, fundidos com -ExcludeDirNames (nao substitui a lista por defeito).
.PARAMETER AlsoExcludeCsv
  Uma string com nomes separados por virgula ou ponto-e-virgula (ex.: "backups,raw"). Fundido como AlsoExclude.
  Se vazio e existir a variavel de ambiente FLATTEN_ALSO_EXCLUDE, usa essa (util para flatten-videos.bat).
#>
param(
    [string]$Root = (Get-Location).Path,
    [switch]$WhatIf,
    [switch]$IncludeTrailers,
    [string[]]$ExcludeDirNames = @('trailers', 'preview', '.thumb_cache', 'incoming', 'node_modules', '.git', '.nuxt', 'dist', 'output'),
    [string[]]$AlsoExclude = @(),
    [string]$AlsoExcludeCsv = ''
)

$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path -LiteralPath $Root).Path.TrimEnd('\')

$effectiveExclude = [System.Collections.Generic.List[string]]::new()
foreach ($n in $ExcludeDirNames) {
    if ($n) { [void]$effectiveExclude.Add($n) }
}
foreach ($n in $AlsoExclude) {
    if ($n) { [void]$effectiveExclude.Add($n.Trim()) }
}
$csvSrc = $AlsoExcludeCsv
if (-not $csvSrc -and $env:FLATTEN_ALSO_EXCLUDE) { $csvSrc = $env:FLATTEN_ALSO_EXCLUDE }
if ($csvSrc) {
    foreach ($p in $csvSrc.Split([char[]]@(',', ';'), [StringSplitOptions]::RemoveEmptyEntries)) {
        $t = $p.Trim()
        if ($t) { [void]$effectiveExclude.Add($t) }
    }
}
if (-not $IncludeTrailers) {
    $hasT = $false
    foreach ($x in $effectiveExclude) {
        if ($x.ToLowerInvariant() -eq 'trailers') { $hasT = $true; break }
    }
    if (-not $hasT) { [void]$effectiveExclude.Insert(0, 'trailers') }
}
else {
    while ($true) {
        $ix = -1
        for ($i = 0; $i -lt $effectiveExclude.Count; $i++) {
            if ($effectiveExclude[$i].ToLowerInvariant() -eq 'trailers') { $ix = $i; break }
        }
        if ($ix -lt 0) { break }
        $effectiveExclude.RemoveAt($ix)
    }
}

# Sem ".ts" aqui: em projectos de codigo ".ts" e TypeScript, nao MPEG-TS.
$videoExt = @(
    '.mp4', '.mkv', '.avi', '.mov', '.webm', '.m4v', '.wmv', '.flv',
    '.mpeg', '.mpg', '.m2ts', '.mts', '.3gp'
)
$extSet = @{}
foreach ($e in $videoExt) { $extSet[$e.ToLowerInvariant()] = $true }

$script:excluded = @{}
foreach ($n in $effectiveExclude) { $script:excluded[$n.ToLowerInvariant()] = $true }

function Test-AnyPathSegmentExcluded {
    param([string]$FullPath, [string]$RootNorm)
    $rel = $FullPath.Substring($RootNorm.Length).TrimStart('\')
    if (-not $rel) { return $false }
    foreach ($seg in $rel.Split([char[]]@('\', '/'))) {
        if ($seg -and $script:excluded.ContainsKey($seg.ToLowerInvariant())) { return $true }
    }
    return $false
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
$skippedDestExists = 0
$whatIfWouldMove = 0
$whatIfWouldSkipExists = 0

foreach ($f in $files) {
    $dest = Join-Path $Root $f.Name
    $relFrom = $f.FullName.Substring($Root.Length).TrimStart('\')
    if ($WhatIf) {
        if (Test-Path -LiteralPath $dest) {
            Write-Host "[WhatIf] IGNORADO - destino ja existe na raiz: $relFrom  (conflito com $($f.Name))"
            $whatIfWouldSkipExists++
        }
        else {
            Write-Host "[WhatIf] $relFrom  -->  $($f.Name)"
            $whatIfWouldMove++
        }
        continue
    }
    if (Test-Path -LiteralPath $dest) {
        Write-Host "IGNORADO - destino ja existe na raiz (nao movido, nao substituido): $relFrom  ->  $([IO.Path]::GetFileName($dest))"
        $skippedDestExists++
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
    Write-Host ('WhatIf: {0} seriam movidos, {1} ignorados (nome ja existe na raiz), {2} candidatos no total.' -f $whatIfWouldMove, $whatIfWouldSkipExists, $files.Count)
}
else {
    Write-Host ""
    Write-Host ('Feito: {0} movidos, {1} ignorados (destino ja existia), {2} falhas, {3} candidatos.' -f $moved, $skippedDestExists, $skipped, $files.Count)
}
