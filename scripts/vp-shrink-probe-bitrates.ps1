#Requires -Version 5.1
# Bitrates da origem (int64). Caminho em $env:VP_LITERAL_PATH.
# Saida: SRC_V_BPS= / SRC_A_BPS= [/ SRC_TRAILING_JUNK=1]
# Evita bitrate inflado por lixo apos o mdat (ficheiro maior que o MP4 estrutural).
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

function Get-Mp4StructuralLength([string]$filePath) {
    try {
        $fs = [System.IO.File]::OpenRead($filePath)
    } catch {
        return 0L
    }
    try {
        $fileLen = $fs.Length
        if ($fileLen -lt 16) { return 0L }
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

$vBps = 0L
$aBps = 0L
$durSec = 0.0
$fmtBps = 0L
$trailingJunk = $false

$fileLen = 0L
try { $fileLen = (Get-Item -LiteralPath $path).Length } catch { }

$structLen = 0L
if ($fileLen -gt 0) {
    $structLen = Get-Mp4StructuralLength $path
    if ($structLen -gt 0 -and ($fileLen - $structLen) -gt 8MB) {
        $trailingJunk = $true
    } elseif ($structLen -gt 0 -and $fileLen -gt 0 -and ($structLen * 1.0 / $fileLen) -lt 0.92) {
        $trailingJunk = $true
    }
}

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

# Bitrate efectivo do container: se houver lixo apos mdat, recalcular pelo tamanho estrutural.
$effectiveFmtBps = $fmtBps
if ($trailingJunk -and $structLen -gt 0 -and $durSec -gt 0) {
    $effectiveFmtBps = [long][math]::Floor(($structLen * 8L) / $durSec)
}

if ($effectiveFmtBps -gt 0) {
    $fmtVideoEst = [long][math]::Floor($effectiveFmtBps * 0.88)
    if ($aBps -gt 0) {
        $fmtVideoEst = [long][math]::Max(0L, $effectiveFmtBps - $aBps)
    }
    if ($vBps -le 0) {
        $vBps = $fmtVideoEst
    } elseif (-not $trailingJunk -and $fmtVideoEst -gt 0 -and $vBps -lt [long][math]::Floor($fmtVideoEst * 0.45)) {
        # Stream << format sem lixo: confiar no container (stream tag mentiroso).
        $vBps = $fmtVideoEst
    }
    # Com trailing junk: manter stream bitrate se existir (format.file size mentiroso).
}

if ($vBps -le 0) {
    $bytesForEst = if ($structLen -gt 0) { $structLen } else { $fileLen }
    if ($bytesForEst -gt 0 -and $durSec -gt 0) {
        $totalBps = [long][math]::Floor(($bytesForEst * 8L) / $durSec)
        if ($aBps -le 0) { $aBps = [long][math]::Floor($totalBps * 0.10) }
        $vBps = $totalBps - $aBps
        if ($vBps -lt 0) { $vBps = [long][math]::Floor($totalBps * 0.85) }
    }
}

if ($vBps -lt 0) { $vBps = 0 }
if ($aBps -lt 0) { $aBps = 0 }

Write-Output "SRC_V_BPS=$vBps"
Write-Output "SRC_A_BPS=$aBps"
if ($trailingJunk) {
    Write-Output "SRC_TRAILING_JUNK=1"
}
