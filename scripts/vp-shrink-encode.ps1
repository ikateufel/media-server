#Requires -Version 5.1
# Encode shrink (ffmpeg) com caminhos literais — seguro para ', !, &, (, ), espacos, etc.
$ErrorActionPreference = 'Continue'

$ffmpeg = $env:FFMPEG
if (-not $ffmpeg) { exit 1 }

$in = $env:VP_IN
$out = $env:VP_OUT
$log = $env:VP_FLOG
$vf = $env:VP_VF_CHAIN
$af = $env:VP_AF_CHAIN
$mode = $env:VP_ENCODE_MODE

if (-not $in -or -not $out) { exit 1 }

function Expand-FlagTokens([string]$raw) {
    if (-not $raw) { return @() }
    $out = @()
    foreach ($part in ($raw.Trim() -split '\s+(?=-)')) {
        $p = $part.Trim()
        if (-not $p) { continue }
        $sp = $p -split '\s+', 2
        $out += $sp[0]
        if ($sp.Count -gt 1 -and $sp[1]) { $out += $sp[1] }
    }
    return $out
}

function Write-Flog([string]$path, [string[]]$lines) {
    if (-not $path) { return }
    try {
        $dir = Split-Path -Parent -Path $path
        if ($dir -and -not (Test-Path -LiteralPath $dir)) {
            New-Item -ItemType Directory -Path $dir -Force | Out-Null
        }
        # utf8NoBOM quando disponivel (PS 6+); no 5.1 escrever via StreamWriter
        $utf8 = New-Object System.Text.UTF8Encoding $false
        [System.IO.File]::WriteAllLines($path, $lines, $utf8)
    } catch {
        try {
            $lines | Out-File -LiteralPath $path -Encoding ascii
        } catch { }
    }
}

$metaParts = Expand-FlagTokens $env:VP_META_ARGS
$vencParts = Expand-FlagTokens $env:VP_VENC_ARGS

$vencJoined = ($vencParts -join ' ')
$useNvenc = $vencJoined -match 'nvenc'
$useGpuDecode = $env:VP_GPU_DECODE -eq '1' -and $useNvenc

function Build-Args([string]$logLevel) {
    $a = @('-y', '-hide_banner', '-loglevel', $logLevel)
    if ($useGpuDecode) {
        $a += @('-hwaccel', 'cuda')
    }
    $a += @('-i', $in)

    $threadArg = if ($useNvenc) { '2' } else { '0' }

    if ($mode -eq 'av') {
        $a += @(
            '-filter_complex', "[0:v]$vf[v];[0:a]$af[a]",
            '-map', '[v]', '-map', '[a]'
        )
        $a += $vencParts
        $audioBk = $env:VP_AUDIO_BK
        if ($audioBk -and $audioBk.Trim()) {
            $ab = if ($audioBk -match 'k$') { $audioBk } else { "$audioBk`k" }
        } else {
            $ab = '128k'
        }
        $a += @('-c:a', 'aac', '-b:a', $ab)
        $a += $metaParts
        $a += @('-movflags', '+faststart', '-threads', $threadArg, $out)
    } else {
        $a += @('-vf', $vf, '-an')
        $a += $vencParts
        $a += $metaParts
        $a += @('-movflags', '+faststart', '-threads', $threadArg, $out)
    }
    return $a
}

$args = Build-Args 'error'
$cmdPreview = (@($ffmpeg) + $args | ForEach-Object {
    if ($_ -match '[\s"]') { '"' + ($_ -replace '"', '\"') + '"' } else { $_ }
}) -join ' '

$outLines = @()
try {
    $outLines = & $ffmpeg @args 2>&1 | ForEach-Object { "$_" }
} catch {
    $outLines = @("EXCEPTION: $($_.Exception.Message)")
}
$exit = $LASTEXITCODE
if ($null -eq $exit) { $exit = 1 }

# Se falhou sem mensagem util, repetir com loglevel warning (so para o log).
if ($exit -ne 0 -and ($outLines.Count -eq 0 -or (($outLines -join '') -match '^\s*$'))) {
    $args2 = Build-Args 'warning'
    try {
        $retryLines = & $ffmpeg @args2 2>&1 | ForEach-Object { "$_" }
        if ($retryLines -and $retryLines.Count -gt 0) {
            $outLines = @('(re-run loglevel=warning)') + $retryLines
        }
    } catch {
        $outLines = @("EXCEPTION on retry: $($_.Exception.Message)")
    }
    if ($null -eq $LASTEXITCODE) { $exit = 1 } else { $exit = $LASTEXITCODE }
}

$flogLines = @(
    "exit=$exit"
    "mode=$mode"
    "gpu_decode=$useGpuDecode"
    "cmd=$cmdPreview"
    '--- ffmpeg ---'
)
if ($outLines -and $outLines.Count -gt 0) {
    $flogLines += $outLines
} else {
    $flogLines += '(sem saida stderr/stdout do ffmpeg)'
}

Write-Flog $log $flogLines

exit $exit
