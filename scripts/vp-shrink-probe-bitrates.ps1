#Requires -Version 5.1
# Bitrates da origem (int64). Caminho em $env:VP_LITERAL_PATH. Saida: SRC_V_BPS= / SRC_A_BPS=
# Preferir format.bit_rate quando o bit_rate do stream de video esta grosseiramente baixo
# (comum em MP4 onde o stream reporta ~1 Mbps e o format ~18 Mbps).
$path = $env:VP_LITERAL_PATH
if (-not $path) { exit 1 }

$ffprobe = $env:FFPROBE
if (-not $ffprobe) { $ffprobe = 'ffprobe' }

function Parse-Long([string]$s) {
    if (-not $s) { return 0L }
    $v = 0L
    if ([long]::TryParse($s.Trim(), [System.Globalization.NumberStyles]::Integer, [System.Globalization.CultureInfo]::InvariantCulture, [ref]$v)) {
        return $v
    }
    return 0L
}

function Parse-Double([string]$s) {
    if (-not $s) { return 0.0 }
    $v = 0.0
    if ([double]::TryParse($s.Trim(), [System.Globalization.NumberStyles]::Float, [System.Globalization.CultureInfo]::InvariantCulture, [ref]$v)) {
        return $v
    }
    return 0.0
}

$vBps = 0L
$aBps = 0L
$durSec = 0.0
$fmtBps = 0L

try {
    $jsonText = & $ffprobe -v error -print_format json -show_streams -show_format -i $path 2>$null
    if ($jsonText) {
        $json = $jsonText | ConvertFrom-Json
        $v = @($json.streams | Where-Object { $_.codec_type -eq 'video' })[0]
        $a = @($json.streams | Where-Object { $_.codec_type -eq 'audio' })[0]
        $fmt = $json.format
        $vBps = Parse-Long $v.bit_rate
        $aBps = Parse-Long $a.bit_rate
        $fmtBps = Parse-Long $fmt.bit_rate
        $durSec = Parse-Double $fmt.duration
    }
} catch {
    # fallback abaixo
}

# Stream video bitrate mentiroso vs format (ex.: 1.5 Mbps stream, 18 Mbps format).
if ($fmtBps -gt 0) {
    $fmtVideoEst = [long][math]::Floor($fmtBps * 0.88)
    if ($aBps -gt 0) {
        $fmtVideoEst = [long][math]::Max(0L, $fmtBps - $aBps)
    }
    if ($vBps -le 0) {
        $vBps = $fmtVideoEst
    } elseif ($fmtVideoEst -gt 0 -and $vBps -lt [long][math]::Floor($fmtVideoEst * 0.45)) {
        # Stream << format: usar estimativa do container.
        $vBps = $fmtVideoEst
    }
}

if ($vBps -le 0) {
    $fileLen = 0L
    try { $fileLen = (Get-Item -LiteralPath $path).Length } catch { }
    if ($fileLen -gt 0 -and $durSec -gt 0) {
        $totalBps = [long][math]::Floor(($fileLen * 8L) / $durSec)
        if ($aBps -le 0) { $aBps = [long][math]::Floor($totalBps * 0.10) }
        $vBps = $totalBps - $aBps
        if ($vBps -lt 0) { $vBps = [long][math]::Floor($totalBps * 0.85) }
    }
}

if ($vBps -lt 0) { $vBps = 0 }
if ($aBps -lt 0) { $aBps = 0 }

# ASCII sem BOM — o .bat faz for /f e set /a.
Write-Output "SRC_V_BPS=$vBps"
Write-Output "SRC_A_BPS=$aBps"
