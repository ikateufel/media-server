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

$args = @(
    '-y', '-hide_banner', '-loglevel', 'error', '-i', $in
)

if ($mode -eq 'av') {
    $args += @(
        '-filter_complex', "[0:v]$vf[v];[0:a]$af[a]",
        '-map', '[v]', '-map', '[a]'
    )
    $args += $vencParts
    $args += @('-c:a', 'aac', '-b:a', '128k')
    $args += $metaParts
    $args += @('-movflags', '+faststart', '-threads', '0', $out)
} else {
    $args += @('-vf', $vf, '-an')
    $args += $vencParts
    $args += $metaParts
    $args += @('-movflags', '+faststart', '-threads', '0', $out)
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
