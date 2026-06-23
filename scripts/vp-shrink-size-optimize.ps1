#Requires -Version 5.1
# Retry em 720p+ com bitrate menor (mesma familia de codec) quando a saida ficou maior que a origem.
# Env: VP_IN, VP_OUT, VP_ORIG_BYTES, VP_SRC_H, VP_H_OUT, VP_VEL, VP_SRC_V_BPS, VP_ENCODER_KIND,
#      VP_SHRINK_H_MIN, VP_FFMPEG, VP_FFPROBE, VP_TRAILER_NVENC_PRESET

$ErrorActionPreference = 'Stop'

$in = $env:VP_IN
$out = $env:VP_OUT
$origBytes = [int64]$env:VP_ORIG_BYTES
$srcH = [int]$env:VP_SRC_H
$hOut = [int]$env:VP_H_OUT
$vel = [double]$env:VP_VEL
$srcVBps = [int64]($env:VP_SRC_V_BPS ?? '0')
$encoderKind = $env:VP_ENCODER_KIND
$minH = [int](if ($env:VP_SHRINK_H_MIN) { $env:VP_SHRINK_H_MIN } else { 720 })
$ffmpeg = $env:FFMPEG
$ffprobe = $env:FFPROBE
$nvencPreset = if ($env:VP_TRAILER_NVENC_PRESET) { $env:VP_TRAILER_NVENC_PRESET } else { 'p4' }

if (-not $in -or -not $out -or -not $ffmpeg) { exit 1 }
if ($origBytes -le 0) { exit 1 }

function Test-Nvenc([string]$codec) {
    & $ffmpeg -hide_banner -loglevel error -f lavfi -i 'color=c=black:s=256x144:r=1' -frames:v 1 -c:v $codec -f null NUL 2>$null
    return $LASTEXITCODE -eq 0
}

function Test-HasAudio([string]$path) {
    if (-not $ffprobe) { return $false }
    $r = & $ffprobe -v error -select_streams a:0 -show_entries stream=index -of csv=p=0 $path 2>$null
    return [bool]($r -and $r.Trim())
}

function Get-HeightLadder([int]$sourceH, [int]$targetH, [int]$floorH) {
    $start = if ($sourceH -gt 0) { [Math]::Min($sourceH, $targetH) } else { $targetH }
    $list = [System.Collections.Generic.List[int]]::new()
    foreach ($h in @(1080, 900, 720)) {
        if ($h -le $start -and $h -ge $floorH) { [void]$list.Add($h) }
    }
    if ($start -ge $floorH -and -not $list.Contains($start)) { [void]$list.Add($start) }
    return ($list | Sort-Object -Descending -Unique)
}

function Get-VencArgs([string]$kind, [int]$targetK) {
    $maxK = [math]::Max(400, [int][math]::Round($targetK * 1.15))
    $bufK = [math]::Max(800, $targetK * 2)
    switch ($kind) {
        'hevc_nvenc' {
            if (-not (Test-Nvenc 'hevc_nvenc')) { return $null }
            return @('-c:v', 'hevc_nvenc', '-preset', $nvencPreset, '-rc', 'vbr', '-b:v', "${targetK}k", '-maxrate', "${maxK}k", '-bufsize', "${bufK}k", '-tag:v', 'hvc1')
        }
        'libx265' {
            return @('-c:v', 'libx265', '-preset', 'fast', '-b:v', "${targetK}k", '-maxrate', "${maxK}k", '-bufsize', "${bufK}k", '-tag:v', 'hvc1')
        }
        'h264_nvenc' {
            if (-not (Test-Nvenc 'h264_nvenc')) { return $null }
            return @('-c:v', 'h264_nvenc', '-preset', $nvencPreset, '-rc', 'vbr', '-b:v', "${targetK}k", '-maxrate', "${maxK}k", '-bufsize', "${bufK}k")
        }
        'libx264' {
            return @('-c:v', 'libx264', '-preset', 'superfast', '-tune', 'zerolatency', '-b:v', "${targetK}k", '-maxrate', "${maxK}k", '-bufsize', "${bufK}k")
        }
        default { return $null }
    }
}

function Invoke-ShrinkAttempt {
    param(
        [string]$inputPath,
        [string]$tempOut,
        [int]$height,
        [string[]]$vencArgs,
        [bool]$hasAudio,
        [int]$audioK
    )
    $scalePart = if ($height -gt 0) { ",scale=-2:${height}:flags=bilinear" } else { '' }
    $vf = "setpts=PTS/$vel$scalePart"
    $meta = @(
        '-metadata', 'vp_shrink=1',
        '-metadata', "vp_shrink_speed=$vel",
        '-metadata', "vp_shrink_height=$height",
        '-metadata', 'vp_shrink_codec=size_opt',
        '-metadata', 'vp_shrink_size_opt=1'
    )
    if (Test-Path -LiteralPath $tempOut) { Remove-Item -LiteralPath $tempOut -Force -ErrorAction SilentlyContinue }
    if ($hasAudio) {
        $af = "aformat=sample_rates=48000:channel_layouts=stereo,aresample=async=1:first_pts=0,atempo=$vel"
        $args = @(
            '-y', '-hide_banner', '-loglevel', 'error', '-i', $inputPath,
            '-filter_complex', "[0:v]$vf[v];[0:a]$af[a]",
            '-map', '[v]', '-map', '[a]'
        ) + $vencArgs + @('-c:a', 'aac', '-b:a', "${audioK}k") + $meta + @('-movflags', '+faststart', '-threads', '0', $tempOut)
    } else {
        $args = @(
            '-y', '-hide_banner', '-loglevel', 'error', '-i', $inputPath,
            '-vf', $vf, '-an'
        ) + $vencArgs + $meta + @('-movflags', '+faststart', '-threads', '0', $tempOut)
    }
    & $ffmpeg @args 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) { return $null }
    if (-not (Test-Path -LiteralPath $tempOut)) { return $null }
    if ($ffprobe) {
        & $ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 $tempOut 2>$null | Out-Null
        if ($LASTEXITCODE -ne 0) { return $null }
    }
    return (Get-Item -LiteralPath $tempOut).Length
}

$baseTargetK = if ($srcVBps -gt 0) {
    [math]::Max(400, [int][math]::Floor(($srcVBps / 1000.0) / $vel * 0.92))
} else { 900 }

$kind = if ($encoderKind) { $encoderKind } else { 'h264_nvenc' }
$bitrateFactors = @(0.85, 0.75, 0.65, 0.55)
$heights = Get-HeightLadder $srcH $hOut $minH
$hasAudio = Test-HasAudio $in
$audioK = 96

$bestPath = $out
$bestBytes = if (Test-Path -LiteralPath $out) { (Get-Item -LiteralPath $out).Length } else { [int64]::MaxValue }
$tmpdir = Join-Path $env:TEMP ("vp-shrink-opt-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmpdir -Force | Out-Null

try {
    $foundUnderOrig = $false
  factorLoop: foreach ($factor in $bitrateFactors) {
        $targetK = [math]::Max(400, [int][math]::Floor($baseTargetK * $factor))
        $vencArgs = Get-VencArgs $kind $targetK
        if (-not $vencArgs) { continue }
        foreach ($h in $heights) {
            $tmp = Join-Path $tmpdir ("try_${h}_${targetK}_$kind.mp4")
            $bytes = Invoke-ShrinkAttempt -inputPath $in -tempOut $tmp -height $h -vencArgs $vencArgs -hasAudio $hasAudio -audioK $audioK
            if (-not $bytes) { continue }
            Write-Output "[META] retry ${h}px $kind ${targetK}k: $([math]::Round($bytes/1MB, 1)) MB"
            if ($bytes -lt $bestBytes) {
                $bestBytes = $bytes
                $bestPath = $tmp
            }
            if ($bytes -le $origBytes) {
                Copy-Item -LiteralPath $tmp -Destination $out -Force
                $pct = [math]::Round(($origBytes - $bytes) * 100.0 / $origBytes)
                Write-Output "[RETRY-OK] ${h}px $kind ${targetK}k — $([math]::Round($bytes/1MB, 1)) MB (origem $([math]::Round($origBytes/1MB, 1)) MB, -$pct%)"
                $foundUnderOrig = $true
                break factorLoop
            }
        }
    }

    if (-not $foundUnderOrig) {
        if ($bestPath -ne $out -and (Test-Path -LiteralPath $bestPath)) {
            Copy-Item -LiteralPath $bestPath -Destination $out -Force
            $sign = if ($bestBytes -le $origBytes) { '-' } else { '+' }
            $pct = [math]::Abs([math]::Round(($bestBytes - $origBytes) * 100.0 / $origBytes))
            Write-Output "[RETRY-BEST] menor saida em >=${minH}px: $([math]::Round($bestBytes/1MB, 1)) MB (origem $([math]::Round($origBytes/1MB, 1)) MB, ${sign}${pct}%)"
        } else {
            Write-Output '[AVISO] retries nao melhoraram o tamanho.'
        }
    }
} finally {
    Remove-Item -LiteralPath $tmpdir -Recurse -Force -ErrorAction SilentlyContinue
}

exit 0
