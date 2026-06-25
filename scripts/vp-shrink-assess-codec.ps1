#Requires -Version 5.1
# Avalia codec de origem (env: VP_SRC_VCODEC). Exit 0=OK, 1=ignorar shrink.
# Escreve mensagem em stdout (uma linha).
$ErrorActionPreference = 'Stop'

$raw = $env:VP_SRC_VCODEC
if (-not $raw) { $raw = '' }
$c = $raw.Trim().ToLowerInvariant()

$blocked = @('', 'mjpeg', 'png', 'bmp', 'gif', 'rawvideo', 'webp', 'tiff', 'jpeg2000')
$unlikely = @('vp9', 'av1', 'vp8', 'prores', 'dnxhd', 'ffv1', 'utvideo', 'v210', 'r210')
$allowOther = @(
    'mpeg4', 'msmpeg4v2', 'msmpeg4v3', 'mpeg2video', 'mpeg1video',
    'wmv3', 'wmv2', 'wmv1', 'vc1', 'flv1', 'rv40', 'rv30', 'h263', 'theora'
)

function Get-Family([string]$name) {
    if ($name -eq 'hevc' -or $name -eq 'h265') { return 'hevc' }
    if ($name -eq 'h264' -or $name -like 'avc*') { return 'h264' }
    return 'other'
}

if (-not $c) {
    Write-Output 'Codec de video desconhecido (ffprobe nao devolveu codec_name).'
    exit 1
}
if ($blocked -contains $c) {
    Write-Output "Codec «$raw» nao e video comprimido — ignorado para shrink."
    exit 1
}
if ($unlikely -contains $c) {
    Write-Output "Codec «$raw» — shrink improvavel (muito lento ou quase sem reducao)."
    exit 1
}

$family = Get-Family $c
if ($family -eq 'h264' -or $family -eq 'hevc') { exit 0 }
if ($allowOther -contains $c) { exit 0 }

Write-Output "Codec «$raw» nao suportado para shrink automatico."
exit 1
