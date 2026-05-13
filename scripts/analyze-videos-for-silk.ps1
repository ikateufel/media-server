<#
.SYNOPSIS
  Lista vídeos cuja análise sugere problemas no Amazon Silk / Fire TV (faststart, codec, contentor).
.DESCRIPTION
  Usa ffprobe (streams) e leitura leve dos átomos de topo (moov/mdat) em ficheiros ISO BMFF.
  Critérios conservadores: H.264 + AAC em MP4 com moov antes do primeiro mdat; contentores WebM/MKV/AVI
  marcados como pouco fiáveis em <video> no Silk.
.PARAMETER Root
  Pasta inicial (default: diretório atual).
.PARAMETER Recurse
  Inclui subpastas.
.PARAMETER Extensions
  Extensões a incluir (default: mp4, m4v, mkv, webm, avi, mov, wmv, 3gp, ogv).
#>
param(
    [string]$Root = (Get-Location).Path,
    [switch]$Recurse,
    [string[]]$Extensions = @('.mp4', '.m4v', '.mkv', '.webm', '.avi', '.mov', '.wmv', '.3gp', '.ogv')
)

$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path -LiteralPath $Root).Path
$null = Get-Command ffprobe -ErrorAction Stop

function Get-IsoBmffMoovMdatOffsets {
    param([string]$Path)
    $fs = $null
    try {
        $fs = [System.IO.File]::OpenRead($Path)
        $len = $fs.Length
        $pos = [long]0
        $moovOff = [long]-1
        $mdatOff = [long]-1
        $buf8 = New-Object byte[] 8
        $guard = 0
        while ($pos + 8 -le $len -and $guard -lt 65536) {
            $guard++
            $fs.Position = $pos
            if ($fs.Read($buf8, 0, 8) -lt 8) { break }
            $sz =
                ([uint32]$buf8[0] -shl 24) -bor ([uint32]$buf8[1] -shl 16) -bor ([uint32]$buf8[2] -shl 8) -bor [uint32]$buf8[3]
            $typ = [System.Text.Encoding]::ASCII.GetString($buf8, 4, 4)
            [long]$boxLen = 0
            if ($sz -eq 1) {
                $xb = New-Object byte[] 8
                if ($fs.Read($xb, 0, 8) -lt 8) { break }
                $boxLen = 0
                for ($i = 0; $i -lt 8; $i++) {
                    $boxLen = ($boxLen * 256) + $xb[$i]
                }
            }
            elseif ($sz -eq 0) {
                $boxLen = $len - $pos
            }
            else {
                $boxLen = [long]$sz
            }
            if ($boxLen -lt 8) { break }
            if ($typ -eq 'moov' -and $moovOff -lt 0) { $moovOff = $pos }
            if ($typ -eq 'mdat' -and $mdatOff -lt 0) { $mdatOff = $pos }
            $next = $pos + $boxLen
            if ($next -le $pos) { break }
            $pos = $next
        }
        return [pscustomobject]@{ Moov = $moovOff; Mdat = $mdatOff }
    }
    catch {
        return $null
    }
    finally {
        if ($null -ne $fs) { $fs.Dispose() }
    }
}

function Test-IsoBmffLikely {
    param([string]$Path)
    $fs = $null
    try {
        $fs = [System.IO.File]::OpenRead($Path)
        $buf = New-Object byte[] 8
        if ($fs.Read($buf, 0, 8) -lt 8) { return $false }
        $typ = [System.Text.Encoding]::ASCII.GetString($buf, 4, 4)
        return ($typ -eq 'ftyp' -or $typ -eq 'moov' -or $typ -eq 'mdat')
    }
    catch {
        return $false
    }
    finally {
        if ($null -ne $fs) { $fs.Dispose() }
    }
}

function Invoke-FfprobeJson {
    param([string]$Path)
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $out = & ffprobe -v error -hide_banner -print_format json -show_format -show_streams -i $Path 2>&1
    }
    finally {
        $ErrorActionPreference = $prevEap
    }
    if ($LASTEXITCODE -ne 0) {
        return [pscustomobject]@{ Ok = $false; Error = ($out | Out-String).Trim() }
    }
    $json = $out | Out-String
    try {
        $data = $json | ConvertFrom-Json
        return [pscustomobject]@{ Ok = $true; Data = $data }
    }
    catch {
        return [pscustomobject]@{ Ok = $false; Error = 'JSON ffprobe invalido' }
    }
}

function Get-SilkIssues {
    param(
        [string]$FullPath,
        [string]$Extension
    )
    $issues = [System.Collections.Generic.List[string]]::new()
    $ext = $Extension.ToLowerInvariant()
    $nonIdealContainers = @{
        '.mkv' = 'Contentor Matroska: reproducao/seek em <video> no Silk e pouco fiavel (preferir MP4).'
        '.webm' = 'Contentor WebM: suporte no Silk e irregular (preferir MP4 H.264 + AAC).'
        '.avi' = 'Contentor AVI: frequentemente sem seek fiavel no browser (preferir MP4).'
        '.wmv' = 'Contentor WMV: muitos WebViews nao descodificam bem (preferir MP4).'
        '.3gp' = 'Contentor 3GP: codec/resolucao antigos; converter para MP4 H.264 + AAC.'
        '.ogv' = 'Contentor Ogg/Theora: raro no Silk (preferir MP4).'
    }
    if ($nonIdealContainers.ContainsKey($ext)) {
        $issues.Add($nonIdealContainers[$ext])
    }

    $pr = Invoke-FfprobeJson -Path $FullPath
    if (-not $pr.Ok) {
        $msg = $pr.Error
        if ($msg.Length -gt 120) { $msg = $msg.Substring(0, 117) + '...' }
        $issues.Add("ffprobe: $msg")
        return [string[]]$issues
    }
    $d = $pr.Data
    $fmtName = if ($d.format.format_name) { $d.format.format_name } else { '' }
    $streams = @($d.streams)
    $v = $streams | Where-Object { $_.codec_type -eq 'video' } | Select-Object -First 1
    $a = $streams | Where-Object { $_.codec_type -eq 'audio' } | Select-Object -First 1

    if (-not $v) {
        $issues.Add('Sem faixa de video.')
        return [string[]]$issues
    }

    $vcodec = $v.codec_name
    if ($vcodec -ne 'h264') {
        $nice = if ($vcodec) { $vcodec } else { '(desconhecido)' }
        $issues.Add("Video: codec $nice - no Silk o mais seguro e H.264 (libx264).")
    }
    else {
        $prof = $v.profile
        if ($prof -and $prof -notmatch '^(Baseline|Constrained Baseline|Main|High)$') {
            $issues.Add("Video H.264: perfil '$prof' pode ser menos compativel (Baseline/Main costumam ser os mais seguros).")
        }
        $lvl = $v.level
        $lvlNum = $null
        if ($null -ne $lvl) {
            try { $lvlNum = [int]$lvl } catch { $lvlNum = $null }
        }
        if ($null -ne $lvlNum -and $lvlNum -gt 51) {
            $issues.Add("Video H.264: nivel $lvlNum (acima de 5.1) pode falhar em hardware de TV.")
        }
    }

    $pix = $v.pix_fmt
    if ($pix -and ($pix -match '10|12|14|16' -or $pix -match 'p10|p12')) {
        $issues.Add("Video: pixel format $pix (alta profundidade) - descodificadores de TV muitas vezes so aceitam 8-bit 4:2:0.")
    }

    if ($a) {
        $acodec = $a.codec_name
        $safeAudio = @('aac', 'mp3')
        if ($acodec -notin $safeAudio) {
            if ($acodec -in @('ac3', 'eac3')) {
                $issues.Add('Audio AC-3/E-AC-3: pode nao tocar em alguns WebViews (AAC e o mais seguro).')
            }
            else {
                $issues.Add("Audio: codec $acodec - para MP4 no browser, AAC e o mais compativel.")
            }
        }
    }
    else {
        $issues.Add('Sem faixa de audio (so video).')
    }

    $isoish = $fmtName -match 'mp4|isom|iso2|avc1|dash|mov|quicktime' -or
        ($ext -in @('.mp4', '.m4v', '.mov', '.3gp'))
    if ($isoish -and (Test-IsoBmffLikely -Path $FullPath)) {
        $off = Get-IsoBmffMoovMdatOffsets -Path $FullPath
        if ($null -ne $off -and $off.Moov -ge 0 -and $off.Mdat -ge 0) {
            if ($off.Moov -gt $off.Mdat) {
                $issues.Add('MP4/MOV sem faststart: atomo moov depois do mdat - seek/buffer no Silk costuma piorar (usar -movflags +faststart).')
            }
        }
    }

    return [string[]]$issues
}

$extSet = @{}
foreach ($e in $Extensions) {
    $x = $e.ToLowerInvariant()
    if (-not $x.StartsWith('.')) { $x = ".$x" }
    $extSet[$x] = $true
}

$gciArgs = @{ LiteralPath = $Root; File = $true }
if ($Recurse) {
    $files = Get-ChildItem @gciArgs -Recurse
}
else {
    $files = Get-ChildItem @gciArgs
}

$candidates = $files | Where-Object { $extSet.ContainsKey($_.Extension.ToLowerInvariant()) } | Sort-Object FullName

if (-not $candidates.Count) {
    Write-Host "Nenhum ficheiro com as extensoes pedidas em: $Root$(if ($Recurse) { ' (recursivo)' })"
    exit 0
}

$bad = [System.Collections.Generic.List[object]]::new()
foreach ($f in $candidates) {
    $issues = Get-SilkIssues -FullPath $f.FullName -Extension $f.Extension
    if ($issues.Count -gt 0) {
        $bad.Add([pscustomobject]@{ Path = $f.FullName; Issues = $issues })
    }
}

Write-Host ""
Write-Host "=== Videos com avisos para Silk / Fire TV ($($bad.Count) de $($candidates.Count)) ==="
Write-Host ""

if ($bad.Count -eq 0) {
    Write-Host "Nenhum problema detetado pelos criterios deste script (ou ffprobe nao encontrou streams)."
    exit 0
}

foreach ($row in $bad) {
    Write-Host $row.Path
    foreach ($i in $row.Issues) {
        Write-Host "  - $i"
    }
    Write-Host ""
}

Write-Host "---"
Write-Host "Nota: criterios conservadores; alguns avisos podem ser aceitaveis no teu dispositivo."
Write-Host "      Reencode/remux: scripts/convert-3gp-wmv-to-mp4.ps1 ou ffmpeg com -movflags +faststart."
