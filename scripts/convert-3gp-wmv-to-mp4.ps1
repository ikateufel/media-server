<#
.SYNOPSIS
  Converte todos os .3gp, .wmv e .mov na pasta indicada para .mp4 (H.264 + AAC, faststart).
.DESCRIPTION
  Para cada ficheiro .3gp / .wmv / .mov, corre:
  ffmpeg -i <entrada> -c:v libx264 -c:a aac -movflags +faststart <saida.mp4>
  Por omissão nao substitui .mp4 ja existentes; use -Force para sobrescrever.
.PARAMETER Root
  Pasta onde procurar (default: diretorio atual). Nao e recursivo.
.PARAMETER Force
  Sobrescreve ficheiros .mp4 de destino se ja existirem.
.PARAMETER WhatIf
  Apenas lista os comandos que seriam executados.
#>
param(
    [string]$Root = (Get-Location).Path,
    [switch]$Force,
    [switch]$WhatIf
)

$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path -LiteralPath $Root).Path

$null = Get-Command ffmpeg -ErrorAction Stop

$inputs = Get-ChildItem -LiteralPath $Root -File | Where-Object {
    $e = $_.Extension.ToLowerInvariant()
    $e -eq '.3gp' -or $e -eq '.wmv' -or $e -eq '.mov'
} | Sort-Object Name

if (-not $inputs.Count) {
    Write-Host "Nenhum .3gp, .wmv ou .mov em: $Root"
    exit 0
}

foreach ($f in $inputs) {
    $base = [System.IO.Path]::GetFileNameWithoutExtension($f.Name)
    $out = Join-Path $f.DirectoryName ($base + '.mp4')

    if ((Test-Path -LiteralPath $out) -and -not $Force) {
        Write-Host "Ignorado (ja existe): $out  (use -Force para substituir)"
        continue
    }

    $argList = @(
        '-hide_banner'
        '-i', $f.FullName
        '-c:v', 'libx264'
        '-c:a', 'aac'
        '-movflags', '+faststart'
    )
    if ($Force) { $argList += '-y' } else { $argList += '-n' }
    $argList += $out

    if ($WhatIf) {
        Write-Host "ffmpeg $($argList -join ' ')"
        continue
    }

    Write-Host ">>> $($f.Name) -> $([System.IO.Path]::GetFileName($out))"
    & ffmpeg @argList
    if ($LASTEXITCODE -ne 0) {
        throw "ffmpeg falhou com codigo $LASTEXITCODE para: $($f.FullName)"
    }
}

Write-Host "Concluido. Ficheiros: $($inputs.Count)."
