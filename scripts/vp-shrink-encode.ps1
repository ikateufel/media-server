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

$metaParts = Expand-FlagTokens $env:VP_META_ARGS
$vencParts = Expand-FlagTokens $env:VP_VENC_ARGS

$vencJoined = ($vencParts -join ' ')
$useNvenc = $vencJoined -match 'nvenc'
$useGpuDecode = $env:VP_GPU_DECODE -eq '1' -and $useNvenc

$args = @('-y', '-hide_banner', '-loglevel', 'error')
if ($useGpuDecode) {
    $args += @('-hwaccel', 'cuda')
}
$args += @('-i', $in)

$threadArg = if ($useNvenc) { '2' } else { '0' }

if ($mode -eq 'av') {
    $args += @(
        '-filter_complex', "[0:v]$vf[v];[0:a]$af[a]",
        '-map', '[v]', '-map', '[a]'
    )
    $args += $vencParts
    $audioBk = $env:VP_AUDIO_BK
    if ($audioBk -and $audioBk.Trim()) {
        $ab = if ($audioBk -match 'k$') { $audioBk } else { "$audioBk`k" }
    } else {
        $ab = '128k'
    }
    $args += @('-c:a', 'aac', '-b:a', $ab)
    $args += $metaParts
    $args += @('-movflags', '+faststart', '-threads', $threadArg, $out)
} else {
    $args += @('-vf', $vf, '-an')
    $args += $vencParts
    $args += $metaParts
    $args += @('-movflags', '+faststart', '-threads', $threadArg, $out)
}

$outLines = & $ffmpeg @args 2>&1
$exit = $LASTEXITCODE

if ($log) {
    $dir = Split-Path -Parent -Path $log
    if ($dir -and -not (Test-Path -LiteralPath $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }
    $outLines | Out-File -LiteralPath $log -Encoding utf8
}

exit $exit
