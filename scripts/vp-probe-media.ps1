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

function Get-Mp4StructuralLength([string]$filePath) {
    try {
        $fs = [System.IO.File]::OpenRead($filePath)
    } catch {
        return 0L
    }
    try {
        $fileLen = $fs.Length
        $pos = 0L
        $lastEnd = 0L
        $sawMdat = $false
        $guard = 0
        while ($pos + 8 -le $fileLen -and $guard -lt 64) {
            $guard++
            $null = $fs.Seek($pos, 'Begin')
            $hdr = New-Object byte[] 8
            if ($fs.Read($hdr, 0, 8) -lt 8) { break }
            $size32 = [uint64](($hdr[0] * [uint64]16777216) + ($hdr[1] * 65536) + ($hdr[2] * 256) + $hdr[3])
            $type = [Text.Encoding]::ASCII.GetString($hdr, 4, 4)
            if ($type -notmatch '^[a-zA-Z0-9]{4}$') { break }
            $boxSize = $size32
            $hdrSize = 8
            if ($size32 -eq 1) {
                $ext = New-Object byte[] 8
                if ($fs.Read($ext, 0, 8) -lt 8) { break }
                $boxSize = 0UL
                foreach ($i in 0..7) { $boxSize = ($boxSize -shl 8) + [uint64]$ext[$i] }
                $hdrSize = 16
            } elseif ($size32 -eq 0) {
                $boxSize = [uint64]($fileLen - $pos)
            }
            if ($boxSize -lt [uint64]$hdrSize) { break }
            $next = $pos + [int64]$boxSize
            if ($next -le $pos -or $next -gt $fileLen) { break }
            $lastEnd = $next
            $pos = $next
            if ($type -eq 'mdat') {
                $sawMdat = $true
                break
            }
        }
        if ($sawMdat -and $lastEnd -gt 0) { return $lastEnd }
        return 0L
    } finally {
        $fs.Dispose()
    }
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

$size = 0L
if ($fmt.size) { [void][long]::TryParse($fmt.size, [ref]$size) }
if ($size -le 0) {
    try { $size = (Get-Item -LiteralPath $path).Length } catch { $size = 0 }
}

$structLen = Get-Mp4StructuralLength $path
$trailingJunk = $false
if ($structLen -gt 0 -and $size -gt 0 -and (($size - $structLen) -gt 8MB -or (($structLen * 1.0 / $size) -lt 0.92))) {
    $trailingJunk = $true
    $size = $structLen
}

# Preferir bitrate do stream de video; format.bit_rate fica mentiroso com lixo apos mdat.
$br = '?'
if ($v.bit_rate) { $br = Format-Bitrate $v.bit_rate }
if ($br -eq '?' -and $fmt.bit_rate -and -not $trailingJunk) { $br = Format-Bitrate $fmt.bit_rate }
if ($br -eq '?' -and $fmt.bit_rate -and $trailingJunk -and $structLen -gt 0) {
    $dur = 0.0
    if ($fmt.duration) {
        [void][double]::TryParse(
            [string]$fmt.duration,
            [System.Globalization.NumberStyles]::Float,
            [System.Globalization.CultureInfo]::InvariantCulture,
            [ref]$dur
        )
    }
    if ($dur -gt 0) {
        $est = [long][math]::Floor(($structLen * 8L) / $dur)
        $br = Format-Bitrate ([string]$est)
    }
}

$suffix = if ($trailingJunk) { ' (mp4 util; ficheiro tem lixo extra)' } else { '' }
Write-Output ('{0} {1} {2} video {3} / audio {4} / {5}{6}' -f $vc, $wh, $container, $br, $ac, (Format-Bytes $size), $suffix)
