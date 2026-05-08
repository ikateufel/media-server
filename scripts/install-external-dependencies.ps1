$ErrorActionPreference = 'Stop'

function Test-CommandExists {
  param([Parameter(Mandatory = $true)][string]$Name)
  return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Add-KnownToolDirsToPath {
  $knownDirs = @(
    "$env:LOCALAPPDATA\Microsoft\WinGet\Links",
    "$env:ProgramFiles\ffmpeg\bin",
    "${env:ProgramFiles(x86)}\ffmpeg\bin",
    "C:\ffmpeg\bin",
    "$env:LOCALAPPDATA\Programs\Python\Python312",
    "$env:LOCALAPPDATA\Programs\Python\Python311",
    "$env:LOCALAPPDATA\Programs\Python\Python310",
    "$env:LOCALAPPDATA\Programs\Python\Python312\Scripts",
    "$env:LOCALAPPDATA\Programs\Python\Python311\Scripts",
    "$env:LOCALAPPDATA\Programs\Python\Python310\Scripts"
  )

  foreach ($d in $knownDirs) {
    if ([string]::IsNullOrWhiteSpace($d)) { continue }
    if (-not (Test-Path -LiteralPath $d)) { continue }
    if (($env:PATH -split ';') -contains $d) { continue }
    $env:PATH = "$d;$env:PATH"
  }
}

function Ensure-WingetPresent {
  if (-not (Test-CommandExists 'winget')) {
    throw 'winget nao encontrado. Instale o App Installer da Microsoft Store e execute novamente.'
  }
}

function Install-FfmpegIfMissing {
  if ((Test-CommandExists 'ffmpeg') -and (Test-CommandExists 'ffprobe')) {
    Write-Host '[OK] ffmpeg e ffprobe ja estao no PATH.'
    return
  }

  Ensure-WingetPresent
  Write-Host '[INFO] Instalando FFmpeg (inclui ffprobe) via winget...'
  winget install --id Gyan.FFmpeg -e --accept-package-agreements --accept-source-agreements
  Add-KnownToolDirsToPath

  if ((-not (Test-CommandExists 'ffmpeg')) -or (-not (Test-CommandExists 'ffprobe'))) {
    throw 'FFmpeg/ffprobe ainda nao encontrados apos instalacao.'
  }
}

function Resolve-PythonCommand {
  if (Test-CommandExists 'python') { return @('python') }
  if (Test-CommandExists 'py') { return @('py', '-3') }
  return $null
}

function Install-PythonIfMissing {
  $pyCmd = Resolve-PythonCommand
  if ($null -ne $pyCmd) {
    Write-Host '[OK] Python ja esta no PATH.'
    return $pyCmd
  }

  Ensure-WingetPresent
  Write-Host '[INFO] Instalando Python 3 via winget...'
  winget install --id Python.Python.3.12 -e --accept-package-agreements --accept-source-agreements
  Add-KnownToolDirsToPath

  $pyCmd = Resolve-PythonCommand
  if ($null -eq $pyCmd) {
    throw 'Python nao foi encontrado apos instalacao.'
  }
  return $pyCmd
}

function Invoke-Python {
  param(
    [Parameter(Mandatory = $true)][string[]]$PyCmd,
    [Parameter(Mandatory = $true)][string[]]$Args
  )
  $launcher = $PyCmd[0]
  $prefix = @()
  if ($PyCmd.Length -gt 1) {
    $prefix = $PyCmd[1..($PyCmd.Length - 1)]
  }
  & $launcher @prefix @Args
  if ($LASTEXITCODE -ne 0) {
    throw "Falha ao executar Python: $($Args -join ' ')"
  }
}

Write-Host '== Instalador de dependencias externas =='
Write-Host 'Este script instala/valida: ffmpeg, ffprobe, python3 e pandas.'

if ($env:OS -notlike '*Windows*' -and $PSVersionTable.Platform -ne 'Win32NT') {
  throw 'Este instalador foi feito para Windows.'
}

Add-KnownToolDirsToPath
Install-FfmpegIfMissing
$py = Install-PythonIfMissing

Write-Host '[INFO] Atualizando pip e instalando pandas...'
Invoke-Python -PyCmd $py -Args @('-m', 'pip', 'install', '--upgrade', 'pip')
Invoke-Python -PyCmd $py -Args @('-m', 'pip', 'install', '--upgrade', 'pandas')

Write-Host ''
Write-Host '== Verificacao final =='
& ffmpeg -version | Select-Object -First 1
& ffprobe -version | Select-Object -First 1
Invoke-Python -PyCmd $py -Args @('--version')
Invoke-Python -PyCmd $py -Args @('-m', 'pip', 'show', 'pandas')

Write-Host ''
Write-Host '[OK] Dependencias externas prontas.'
