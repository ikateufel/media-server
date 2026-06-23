#Requires -Version 5.1
# Resumo ffprobe para logs (shrink/editor). Caminho em $env:VP_LITERAL_PATH; FFPROBE opcional.
$path = $env:VP_LITERAL_PATH
if (-not $path) { exit 1 }

$ffprobe = $env:FFPROBE
if (-not $ffprobe) { $ffprobe = 'ffprobe' }

function Format-Bitrate([string]$raw) {
    if (-not $raw) { return '?' }
    $bps = 0L
    if (-not [long]::TryParse($raw, [ref]$bps) -or $bps -le 0) { return '?' }
    $kbps = $bps / 1000.0
    if ($kbps -ge 1000) { return ('~{0:N1} Mbps' -f ($kbps / 1000.0)) }
    return ('~{0:N0} kbps' -f $kbps)
}

function Format-Bytes([long]$bytes) {
    if ($bytes -ge 1GB) { return ('{0:N1} GB' -f ($bytes / 1GB)) }
    if ($bytes -ge 1MB) { return ('{0:N1} MB' -f ($bytes / 1MB)) }
    if ($bytes -ge 1KB) { return ('{0:N0} KB' -f ($bytes / 1KB)) }
    return ('{0} B' -f $bytes)
}

try {
    $jsonText = & $ffprobe -v error -print_format json -show_streams -show_format -i $path 2>$null
    if (-not $jsonText) { exit 1 }
    $json = $jsonText | ConvertFrom-Json
} catch {
    exit 1
}

$v = @($json.streams | Where-Object { $_.codec_type -eq 'video' })[0]
$a = @($json.streams | Where-Object { $_.codec_type -eq 'audio' })[0]
$fmt = $json.format

$vc = if ($v.codec_name) { $v.codec_name } else { '?' }
$wh = if ($v.width -and $v.height) { '{0}x{1}' -f $v.width, $v.height } else { '?' }
$ac = if ($a.codec_name) { $a.codec_name } else { 'sem-audio' }
$container = if ($fmt.format_name) { ($fmt.format_name -split ',')[0] } else { '?' }
$br = Format-Bitrate $fmt.bit_rate
if ($br -eq '?' -and $v.bit_rate) { $br = Format-Bitrate $v.bit_rate }

$size = 0L
if ($fmt.size) { [void][long]::TryParse($fmt.size, [ref]$size) }
if ($size -le 0) {
    try { $size = (Get-Item -LiteralPath $path).Length } catch { $size = 0 }
}

Write-Output ('{0} {1} {2} video {3} / audio {4} / {5}' -f $vc, $wh, $container, $br, $ac, (Format-Bytes $size))
