#Requires -Version 5.1
# Append entrada em data\shrink-multipass.txt (fila UI).
# Env: VP_REPO_ROOT, VP_SOURCE_ROOT, VP_REL_NAME, VP_SHRINK_PHASE (2|3)
#      VP_ORIG_BYTES, VP_OUT_BYTES, VP_OUT_PCT (opcional, detalhe)
$ErrorActionPreference = 'Stop'

function Format-Bytes([long]$n) {
    if ($n -ge 1GB) { return ('{0:N1} GB' -f ($n / 1GB)) }
    if ($n -ge 1MB) { return ('{0:N1} MB' -f ($n / 1MB)) }
    return ('{0:N0} KB' -f [math]::Round($n / 1KB))
}

function Test-WindowsRoot([string]$line) {
    return [bool]($line -match '^[a-zA-Z]:[\\/]')
}

function Parse-MultipassLine([string]$raw) {
    $t = $raw.Trim()
    if ($t -match '^([23])\|(.+)$') {
        return @{ Phase = [int]$Matches[1]; Name = $Matches[2].Trim() }
    }
    return @{ Phase = $null; Name = $t }
}

$repo = $env:VP_REPO_ROOT
$sourceRoot = $env:VP_SOURCE_ROOT
$rel = $env:VP_REL_NAME
$phase = [int]$env:VP_SHRINK_PHASE

if (-not $repo -or -not $sourceRoot -or -not $rel -or ($phase -ne 2 -and $phase -ne 3)) { exit 0 }

$sourceRoot = (Resolve-Path -LiteralPath $sourceRoot).Path.TrimEnd('\')
$rel = $rel.Replace('/', '\').Trim()
$entry = '{0}|{1}' -f $phase, $rel
$key = $rel.ToLowerInvariant()

$dataDir = Join-Path $repo 'data'
if (-not (Test-Path -LiteralPath $dataDir)) {
    New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
}

$multipassPath = Join-Path $dataDir 'shrink-multipass.txt'
$reprocessPath = Join-Path $dataDir 'shrink-reprocess.txt'
$detailPath = Join-Path $dataDir 'shrink-multipass-detail.txt'

$lines = @()
if (Test-Path -LiteralPath $multipassPath) {
    $lines = @(Get-Content -LiteralPath $multipassPath -Encoding utf8)
}
if (-not $lines.Count -or -not ($lines | Where-Object { $_.Trim() -and -not $_.StartsWith('#') })) {
    $lines = @($sourceRoot, '# 2| segunda passagem  |  3| Priorizar tamanho', '')
} else {
    $first = ($lines | Where-Object { $_.Trim() -and -not $_.StartsWith('#') } | Select-Object -First 1)
    if (-not (Test-WindowsRoot $first)) {
        $lines = @($sourceRoot, '# 2| segunda passagem  |  3| Priorizar tamanho') + $lines
    }
}

$found = $false
$newLines = New-Object System.Collections.Generic.List[string]
foreach ($line in $lines) {
    $t = $line.Trim()
    if (-not $t -or $t.StartsWith('#')) {
        [void]$newLines.Add($line)
        continue
    }
    $parsed = Parse-MultipassLine $t
    if ($parsed.Name.ToLowerInvariant() -ne $key) {
        [void]$newLines.Add($line)
        continue
    }
    $found = $true
    $existingPhase = if ($parsed.Phase) { [int]$parsed.Phase } else { 2 }
    if ($existingPhase -ge $phase) {
        [void]$newLines.Add($line)
    } else {
        [void]$newLines.Add($entry)
    }
}
if (-not $found) {
    if ($newLines.Count -and $newLines[$newLines.Count - 1] -ne '') { [void]$newLines.Add('') }
    [void]$newLines.Add($entry)
}
Set-Content -LiteralPath $multipassPath -Value ($newLines -join [Environment]::NewLine) -Encoding utf8

$reprocessLines = @()
if (Test-Path -LiteralPath $reprocessPath) {
    $reprocessLines = @(Get-Content -LiteralPath $reprocessPath -Encoding utf8)
}
if (-not $reprocessLines.Count -or -not ($reprocessLines | Where-Object { $_.Trim() -and -not $_.StartsWith('#') })) {
    $reprocessLines = @($sourceRoot, '')
}
$reExists = $false
foreach ($line in $reprocessLines) {
    $t = $line.Trim()
    if (-not $t -or $t.StartsWith('#')) { continue }
    if ((Parse-MultipassLine $t).Name.ToLowerInvariant() -eq $key) { $reExists = $true; break }
}
if (-not $reExists) {
    if ($reprocessLines.Count -and $reprocessLines[$reprocessLines.Count - 1] -ne '') { $reprocessLines += '' }
    $reprocessLines += $rel
    Set-Content -LiteralPath $reprocessPath -Value ($reprocessLines -join [Environment]::NewLine) -Encoding utf8
}

$orig = 0L
$out = 0L
[void][long]::TryParse($env:VP_ORIG_BYTES, [ref]$orig)
[void][long]::TryParse($env:VP_OUT_BYTES, [ref]$out)
$pct = 0
if ($env:VP_OUT_PCT -match '^\d+') { $pct = [int]$Matches[0] }
elseif ($orig -gt 0 -and $out -gt 0) { $pct = [int][math]::Round($out * 100.0 / $orig) }

if ($orig -gt 0 -and $out -gt 0) {
    $reason = if ($phase -eq 3) { 'maior que origem' } else { 'reducao insuficiente' }
    $header = "fase`tpct_origem`tmotivo`torigem`saida`tnome"
    if (-not (Test-Path -LiteralPath $detailPath)) {
        Set-Content -LiteralPath $detailPath -Value $header -Encoding utf8
    } elseif (-not ((Get-Content -LiteralPath $detailPath -TotalCount 1 -Encoding utf8) -like 'fase*')) {
        $existing = Get-Content -LiteralPath $detailPath -Encoding utf8
        Set-Content -LiteralPath $detailPath -Value (@($header) + $existing) -Encoding utf8
    }
    $row = @($phase, $pct, $reason, (Format-Bytes $orig), (Format-Bytes $out), $rel) -join "`t"
    Add-Content -LiteralPath $detailPath -Value $row -Encoding utf8
}

exit 0
