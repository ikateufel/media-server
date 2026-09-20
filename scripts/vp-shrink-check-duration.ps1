#Requires -Version 5.1
# Compara duracao saida vs origem/velocidade. Exit 0=ok, 2=saida curta demais (origem provavelmente corrupta).
# Env: VP_ORIG_PATH, VP_OUT_PATH, VP_SPEED (ex. 1.5), FFPROBE
$ErrorActionPreference = 'Continue'

$orig = $env:VP_ORIG_PATH
$out = $env:VP_OUT_PATH
$speedRaw = $env:VP_SPEED
$ffprobe = $env:FFPROBE
if (-not $ffprobe) { $ffprobe = 'ffprobe' }
if (-not $orig -or -not $out) { exit 1 }

function Get-DurationSec([string]$path) {
    try {
        $t = & $ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 -i $path 2>$null
        if (-not $t) { return 0.0 }
        $v = 0.0
        if ([double]::TryParse([string]$t.Trim(), [System.Globalization.NumberStyles]::Float, [System.Globalization.CultureInfo]::InvariantCulture, [ref]$v)) {
            return $v
        }
    } catch { }
    return 0.0
}

$speed = 1.5
try {
    $s = 0.0
    if ([double]::TryParse([string]$speedRaw, [System.Globalization.NumberStyles]::Float, [System.Globalization.CultureInfo]::InvariantCulture, [ref]$s) -and $s -gt 0) {
        $speed = $s
    }
} catch { }

$origDur = Get-DurationSec $orig
$outDur = Get-DurationSec $out

if ($origDur -le 1.0 -or $outDur -le 0.0) {
    Write-Output "DUR_CHECK=skip orig=$origDur out=$outDur"
    exit 0
}

$expected = $origDur / $speed
# Aceitar folga (B-frames / EOF). Abaixo de 45% do esperado = bitstream origem ilegivel a meio.
$minOk = $expected * 0.45

$inv = [System.Globalization.CultureInfo]::InvariantCulture
Write-Output ("DUR_ORIG={0}" -f $origDur.ToString('0.###', $inv))
Write-Output ("DUR_OUT={0}" -f $outDur.ToString('0.###', $inv))
Write-Output ("DUR_EXPECTED={0}" -f $expected.ToString('0.###', $inv))
Write-Output ("DUR_MIN_OK={0}" -f $minOk.ToString('0.###', $inv))

if ($outDur + 0.5 -lt $minOk) {
    Write-Output "DUR_CHECK=short"
    exit 2
}

Write-Output "DUR_CHECK=ok"
exit 0
