#Requires -Version 5.1
# Bitrates da origem (int64). Caminho em $env:VP_LITERAL_PATH. Saida: SRC_V_BPS= / SRC_A_BPS=
$path = $env:VP_LITERAL_PATH
if (-not $path) { exit 1 }

$ffprobe = $env:FFPROBE
if (-not $ffprobe) { $ffprobe = 'ffprobe' }

function Parse-Long([string]$s) {
    if (-not $s) { return 0L }
    $v = 0L
    if ([long]::TryParse($s.Trim(), [ref]$v)) { return $v }
    return 0L
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
        if ($fmt.duration) {
            $d = 0.0
            if ([double]::TryParse([string]$fmt.duration, [ref]$d)) { $durSec = $d }
        }
    }
} catch {
    # fallback abaixo
}

if ($vBps -le 0 -and $fmtBps -gt 0) {
    $vBps = [long][math]::Floor($fmtBps * 0.85)
    if ($aBps -le 0) { $aBps = [long][math]::Floor($fmtBps * 0.12) }
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

Write-Output "SRC_V_BPS=$vBps"
Write-Output "SRC_A_BPS=$aBps"
