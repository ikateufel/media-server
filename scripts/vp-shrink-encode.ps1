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
    $tokens = @()
    foreach ($part in ($raw.Trim() -split '\s+(?=-)')) {
        $p = $part.Trim()
        if (-not $p) { continue }
        $sp = $p -split '\s+', 2
        $tokens += $sp[0]
        if ($sp.Count -gt 1 -and $sp[1]) { $tokens += $sp[1] }
    }
    return $tokens
}

function Write-Flog([string]$path, [string[]]$lines) {
    if (-not $path) { return }
    try {
        $dir = Split-Path -Parent -Path $path
        if ($dir -and -not (Test-Path -LiteralPath $dir)) {
            New-Item -ItemType Directory -Path $dir -Force | Out-Null
        }
        $utf8 = New-Object System.Text.UTF8Encoding $false
        [System.IO.File]::WriteAllLines($path, $lines, $utf8)
    } catch {
        try {
            $lines | Out-File -LiteralPath $path -Encoding ascii
        } catch { }
    }
}

function Limit-Lines([string[]]$lines, [int]$head = 24, [int]$tail = 40) {
    if (-not $lines -or $lines.Count -eq 0) { return @() }
    if ($lines.Count -le ($head + $tail + 2)) { return $lines }
    $omit = $lines.Count - $head - $tail
    return @($lines[0..($head - 1)]) + @("... ($omit linhas omitidas) ...") + @($lines[($lines.Count - $tail)..($lines.Count - 1)])
}

function Invoke-FfmpegEncode([string[]]$ffArgs) {
    $captured = New-Object System.Collections.Generic.List[string]
    $exitCode = 1
    try {
        $truncatedNote = $false
        & $ffmpeg @ffArgs 2>&1 | ForEach-Object {
            if ($captured.Count -lt 4000) {
                $captured.Add("$_") | Out-Null
            } elseif (-not $truncatedNote) {
                $captured.Add('(stderr truncado — demasiadas linhas)') | Out-Null
                $truncatedNote = $true
            }
        }
        if ($null -eq $LASTEXITCODE) { $exitCode = 1 } else { $exitCode = [int]$LASTEXITCODE }
    } catch {
        $captured.Add("EXCEPTION: $($_.Exception.Message)") | Out-Null
        $exitCode = 1
    }
    return @{ Exit = $exitCode; Lines = $captured.ToArray() }
}

$metaParts = Expand-FlagTokens $env:VP_META_ARGS
$vencParts = Expand-FlagTokens $env:VP_VENC_ARGS

$vencJoined = ($vencParts -join ' ')
$useNvenc = $vencJoined -match 'nvenc'
$wantGpuDecode = $env:VP_GPU_DECODE -eq '1' -and $useNvenc

function Build-Args([string]$logLevel, [bool]$gpuDecode) {
    $a = @(
        '-y', '-hide_banner', '-loglevel', $logLevel,
        # Ficheiros danificados: nao abortar so por taxa de erro de decode.
        '-max_error_rate', '1.0'
    )
    if ($gpuDecode) {
        $a += @('-hwaccel', 'cuda')
    }
    $a += @('-i', $in)

    $threadArg = if ($useNvenc) { '2' } else { '0' }

    if ($mode -eq 'av') {
        $a += @(
            '-filter_complex', "[0:v]$vf[v];[0:a]$af[a]",
            '-map', '[v]', '-map', '[a]'
        )
        $a += $vencParts
        $audioBk = $env:VP_AUDIO_BK
        if ($audioBk -and $audioBk.Trim()) {
            $ab = if ($audioBk -match 'k$') { $audioBk } else { "$audioBk`k" }
        } else {
            $ab = '128k'
        }
        $a += @('-c:a', 'aac', '-b:a', $ab)
        $a += $metaParts
        $a += @('-movflags', '+faststart', '-threads', $threadArg, $out)
    } else {
        $a += @('-vf', $vf, '-an')
        $a += $vencParts
        $a += $metaParts
        $a += @('-movflags', '+faststart', '-threads', $threadArg, $out)
    }
    return $a
}

function Format-CmdPreview([string[]]$ffArgs) {
    return (@($ffmpeg) + $ffArgs | ForEach-Object {
        if ($_ -match '[\s"]') { '"' + ($_ -replace '"', '\"') + '"' } else { $_ }
    }) -join ' '
}

$gpuDecode = $wantGpuDecode
$ffArgs = Build-Args 'error' $gpuDecode
$cmdPreview = Format-CmdPreview $ffArgs

$result = Invoke-FfmpegEncode $ffArgs
$exit = $result.Exit
$outLines = $result.Lines

# Se falhou com CUDA decode, repetir sem hwaccel (alguns H.264 partem o decoder GPU).
if ($exit -ne 0 -and $gpuDecode) {
    $gpuDecode = $false
    try { if (Test-Path -LiteralPath $out) { Remove-Item -LiteralPath $out -Force -ErrorAction SilentlyContinue } } catch { }
    $ffArgs = Build-Args 'error' $false
    $cmdPreview = Format-CmdPreview $ffArgs
    $retry = Invoke-FfmpegEncode $ffArgs
    $exit = $retry.Exit
    $outLines = @('(retry sem -hwaccel cuda)') + $retry.Lines
}

# Se ainda falhou sem mensagem util, repetir com loglevel warning (so para o log).
if ($exit -ne 0 -and ($outLines.Count -eq 0 -or (($outLines -join '') -match '^\s*$'))) {
    $ffArgs2 = Build-Args 'warning' $gpuDecode
    $retry2 = Invoke-FfmpegEncode $ffArgs2
    if ($retry2.Lines -and $retry2.Lines.Count -gt 0) {
        $outLines = @('(re-run loglevel=warning)') + $retry2.Lines
    }
    $exit = $retry2.Exit
}

# Resumo curto para o .bat / UI (linhas com [DET] no type).
$summaryBits = @()
foreach ($ln in $outLines) {
    if ($ln -match '(?i)Decode error rate|Invalid NAL|error while|Could not|No such|Permission denied|not found|CUDA|nvenc|failed|Conversion failed|Error number') {
        $summaryBits += $ln
        if ($summaryBits.Count -ge 8) { break }
    }
}

$flogLines = @(
    "exit=$exit"
    "mode=$mode"
    "gpu_decode=$gpuDecode"
    "cmd=$cmdPreview"
    '--- summary ---'
)
if ($summaryBits.Count -gt 0) {
    $flogLines += $summaryBits
} else {
    $flogLines += '(sem linhas de erro reconheciveis)'
}
$flogLines += '--- ffmpeg ---'
$flogLines += Limit-Lines $outLines 20 30

Write-Flog $log $flogLines

# Cmd `if errorlevel 1` e fiavel com 0/1; codigos negativos do ffmpeg (ex. -22) podem perder-se.
if ($exit -ne 0) { exit 1 }
exit 0
