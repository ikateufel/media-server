<#
.SYNOPSIS
  Compara pre_selected vs shrinked\ e classifica quem precisa de 2.ª ou 3.ª passagem.
.DESCRIPTION
  So analisa videos na raiz que JA tem saida em shrinked\.

  Fase 2 (2|): saida > 70% do original — precisa 2.ª passagem qualidade.
  Fase 3 (3|): saida > 100% do original — marcar «Priorizar tamanho» (3.ª passagem).
  Se > 100%, entra como 3| (inclui 2.ª automaticamente ao reprocessar).

  Grava:
    data\shrink-multipass.txt   — fila UI (1.ª linha pasta, depois 2|nome ou 3|nome)
    data\shrink-phase2-only.txt — so 2.ª passagem (70% < saida <= 100%)
    data\shrink-phase3.txt      — precisa Priorizar tamanho (> 100%)
    data\shrink-reprocess.txt   — todos (compat., sem prefixo)
.PARAMETER Root
  Pasta pre_selected.
.PARAMETER RepoRoot
  Raiz do projecto video_player.
.PARAMETER WhatIf
  So mostra no ecra.
#>
param(
    [Parameter(Mandatory = $true)]
    [string]$Root,
    [string]$RepoRoot = '',
    [switch]$WhatIf
)

$ErrorActionPreference = 'Stop'
$Phase2MinRatio = 0.70
$Phase3MinRatio = 1.00

$Root = (Resolve-Path -LiteralPath $Root).Path.TrimEnd('\')
$ShrinkedDir = Join-Path $Root 'shrinked'

if (-not $RepoRoot) {
    $RepoRoot = Split-Path -Parent $PSScriptRoot
}
$RepoRoot = (Resolve-Path -LiteralPath $RepoRoot).Path.TrimEnd('\')

$videoExt = @('.mp4', '.mkv', '.m4v', '.avi', '.mov', '.webm', '.wmv')
$extSet = @{}
foreach ($e in $videoExt) { $extSet[$e.ToLowerInvariant()] = $true }

function Format-Bytes([long]$n) {
    if ($n -ge 1GB) { return ('{0:N1} GB' -f ($n / 1GB)) }
    if ($n -ge 1MB) { return ('{0:N1} MB' -f ($n / 1MB)) }
    return ('{0:N0} KB' -f [math]::Round($n / 1KB))
}

$phase2Only = New-Object System.Collections.Generic.List[object]
$phase3 = New-Object System.Collections.Generic.List[object]
$allHits = New-Object System.Collections.Generic.List[object]
$scanned = 0

function Write-EmptyLists {
    param([string]$Repo, [string]$SourceRoot)
    $dataDir = Join-Path $Repo 'data'
    if (-not (Test-Path -LiteralPath $dataDir)) {
        New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
    }
    $empty = @($SourceRoot, '')
    foreach ($name in @('shrink-multipass.txt', 'shrink-phase2-only.txt', 'shrink-phase3.txt', 'shrink-reprocess.txt')) {
        Set-Content -LiteralPath (Join-Path $dataDir $name) -Value ($empty -join "`n") -Encoding utf8
    }
}

if (-not (Test-Path -LiteralPath $ShrinkedDir)) {
    Write-Host "Pasta shrinked nao existe: $ShrinkedDir"
    Write-Host "Nada a listar."
    if (-not $WhatIf) { Write-EmptyLists -Repo $RepoRoot -SourceRoot $Root }
    exit 0
}

Get-ChildItem -LiteralPath $Root -File | ForEach-Object {
    $ext = $_.Extension.ToLowerInvariant()
    if (-not $extSet.ContainsKey($ext)) { return }

    $scanned++
    $srcLen = $_.Length
    if ($srcLen -le 0) { return }

    $stem = [System.IO.Path]::GetFileNameWithoutExtension($_.Name)
    $outPath = Join-Path $ShrinkedDir ($stem + '.mp4')
    if (-not (Test-Path -LiteralPath $outPath)) { return }

    $outLen = (Get-Item -LiteralPath $outPath).Length
    $ratio = $outLen / $srcLen
    if ($ratio -le $Phase2MinRatio) { return }

    $pctOfOrig = [math]::Round($ratio * 100, 1)
    $needs3 = $ratio -gt $Phase3MinRatio
    $tag = if ($needs3) { '3' } else { '2' }
    $reason = if ($needs3) { 'maior que origem' } else { 'reducao insuficiente' }

    $row = [pscustomobject]@{
        Name        = $_.Name
        Tag         = $tag
        Reason      = $reason
        SourceBytes = $srcLen
        OutputBytes = $outLen
        PctOfOrig   = $pctOfOrig
        OutputPath  = $outPath
    }
    [void]$allHits.Add($row)
    if ($needs3) {
        [void]$phase3.Add($row)
    } else {
        [void]$phase2Only.Add($row)
    }
}

Write-Host "===================================================="
Write-Host "  SHRINK-MULTIPASS"
Write-Host "  Origem:  $Root"
Write-Host "  Shrink:  $ShrinkedDir"
Write-Host "  Videos na raiz: $scanned"
Write-Host "  2a passagem (70-100%): $($phase2Only.Count)"
Write-Host "  3a passagem (>100%, Priorizar tamanho): $($phase3.Count)"
Write-Host "  Total multipass: $($allHits.Count)"
Write-Host "===================================================="

foreach ($h in ($allHits | Sort-Object Tag, Name)) {
    $label = if ($h.Tag -eq '3') { 'fase 3' } else { 'fase 2' }
    Write-Host ('  [{0}] {1} - origem {2} / shrinked {3} ({4}% - {5})' -f $label, $h.Name, (Format-Bytes $h.SourceBytes), (Format-Bytes $h.OutputBytes), $h.PctOfOrig, $h.Reason)
}

if ($WhatIf) {
    Write-Host ""
    Write-Host "(WhatIf - ficheiros nao gravados.)"
    exit 0
}

$dataDir = Join-Path $RepoRoot 'data'
if (-not (Test-Path -LiteralPath $dataDir)) {
    New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
}

$multipassLines = New-Object System.Collections.Generic.List[string]
[void]$multipassLines.Add($Root)
$nl = [Environment]::NewLine
[void]$multipassLines.Add('# 2| segunda passagem  |  3| Priorizar tamanho')
foreach ($h in ($allHits | Sort-Object Tag, Name)) {
    [void]$multipassLines.Add(('{0}|{1}' -f $h.Tag, $h.Name))
}

$phase2Lines = New-Object System.Collections.Generic.List[string]
[void]$phase2Lines.Add($Root)
foreach ($h in ($phase2Only | Sort-Object Name)) { [void]$phase2Lines.Add($h.Name) }

$phase3Lines = New-Object System.Collections.Generic.List[string]
[void]$phase3Lines.Add($Root)
[void]$phase3Lines.Add('# Marcar Priorizar tamanho na pagina Shrink')
foreach ($h in ($phase3 | Sort-Object Name)) { [void]$phase3Lines.Add($h.Name) }

$reprocessLines = New-Object System.Collections.Generic.List[string]
[void]$reprocessLines.Add($Root)
foreach ($h in ($allHits | Sort-Object Name)) { [void]$reprocessLines.Add($h.Name) }

Set-Content -LiteralPath (Join-Path $dataDir 'shrink-multipass.txt') -Value ($multipassLines -join $nl) -Encoding utf8
Set-Content -LiteralPath (Join-Path $dataDir 'shrink-phase2-only.txt') -Value ($phase2Lines -join $nl) -Encoding utf8
Set-Content -LiteralPath (Join-Path $dataDir 'shrink-phase3.txt') -Value ($phase3Lines -join $nl) -Encoding utf8
Set-Content -LiteralPath (Join-Path $dataDir 'shrink-reprocess.txt') -Value ($reprocessLines -join $nl) -Encoding utf8

$detailPath = Join-Path $dataDir 'shrink-multipass-detail.txt'
$detailHeader = "fase`tpct_origem`tmotivo`torigem`saida`tnome"
$detailBody = ($allHits | Sort-Object Tag, Name | ForEach-Object {
        @($_.Tag, $_.PctOfOrig, $_.Reason, (Format-Bytes $_.SourceBytes), (Format-Bytes $_.OutputBytes), $_.Name) -join "`t"
    }) -join $nl
Set-Content -LiteralPath $detailPath -Value ($detailHeader + $nl + $detailBody + $nl) -Encoding utf8

Write-Host ""
Write-Host "Listas gravadas em: $dataDir"
Write-Host '  shrink-multipass.txt      (fila com 2| / 3|)'
Write-Host "  shrink-phase2-only.txt"
Write-Host "  shrink-phase3.txt"
Write-Host "  shrink-reprocess.txt"
Write-Host "  shrink-multipass-detail.txt"

exit 0
