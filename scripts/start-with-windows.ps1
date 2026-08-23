# Arranque Windows: npm install / build se houver alteracao; reinicia o servidor se necessario.
# Guardar em ASCII / UTF-8 com BOM — PowerShell 5.1 falha com UTF-8 sem BOM e tracos Unicode.
$ErrorActionPreference = 'Continue'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location -LiteralPath $root
. (Join-Path $PSScriptRoot 'lib\windows-production-server.ps1')

$logDir = Get-ProductionServerLogDir $root
$logPath = Join-Path $logDir 'startup-server.log'
$runLogPath = Join-Path $logDir 'startup-node.log'
$errPath = Join-Path $logDir 'startup-error.log'
$stampPath = Join-Path $logDir 'startup-build.stamp'

function Write-StartupLog([string]$msg, [string]$path = $logPath) {
  $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $msg"
  try {
    $fs = [System.IO.File]::Open($path, [System.IO.FileMode]::Append, [System.IO.FileAccess]::Write, [System.IO.FileShare]::ReadWrite)
    $sw = New-Object System.IO.StreamWriter($fs, [System.Text.UTF8Encoding]::new($false))
    $sw.WriteLine($line)
    $sw.Dispose()
    $fs.Dispose()
  } catch {}
}

function Ensure-UserPath {
  try {
    $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $user = [Environment]::GetEnvironmentVariable('Path', 'User')
    $parts = @()
    foreach ($chunk in @($machine, $user, $env:Path)) {
      if (-not $chunk) { continue }
      foreach ($p in ($chunk -split ';')) {
        $t = $p.Trim()
        if ($t -and ($parts -notcontains $t)) { $parts += $t }
      }
    }
    $env:Path = ($parts -join ';')
  } catch {}
}

function Ensure-NodeOnPath {
  Ensure-UserPath
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if ($cmd) { return }
  $candidates = @(
    (Join-Path $env:ProgramFiles 'nodejs'),
    (Join-Path ${env:ProgramFiles(x86)} 'nodejs'),
    'C:\nvm4w\nodejs',
    (Join-Path $env:LOCALAPPDATA 'Programs\nodejs'),
    (Join-Path $env:APPDATA 'nvm')
  )
  foreach ($dir in $candidates) {
    if (-not $dir) { continue }
    $nodeExe = Join-Path $dir 'node.exe'
    if (Test-Path -LiteralPath $nodeExe -PathType Leaf) {
      $env:Path = "$dir;$env:Path"
      Write-StartupLog "PATH: adicionado $dir"
      return
    }
  }
  Write-StartupLog 'AVISO: node.exe nao encontrado no PATH nem em pastas conhecidas' $errPath
}

function Invoke-LoggedNpm([string]$npmArgs) {
  Write-StartupLog "a correr: npm $npmArgs"
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = 'cmd.exe'
  $psi.Arguments = "/c npm $npmArgs"
  $psi.WorkingDirectory = $root
  $psi.UseShellExecute = $false
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.CreateNoWindow = $true
  $psi.EnvironmentVariables['Path'] = $env:Path
  $p = [System.Diagnostics.Process]::Start($psi)
  $out = $p.StandardOutput.ReadToEnd()
  $err = $p.StandardError.ReadToEnd()
  $p.WaitForExit()
  if ($out) {
    try {
      $fs = [System.IO.File]::Open($logPath, [System.IO.FileMode]::Append, [System.IO.FileAccess]::Write, [System.IO.FileShare]::ReadWrite)
      $sw = New-Object System.IO.StreamWriter($fs, [System.Text.UTF8Encoding]::new($false))
      $sw.Write($out)
      $sw.Dispose()
      $fs.Dispose()
    } catch {}
  }
  if ($err) {
    try {
      $fs = [System.IO.File]::Open($logPath, [System.IO.FileMode]::Append, [System.IO.FileAccess]::Write, [System.IO.FileShare]::ReadWrite)
      $sw = New-Object System.IO.StreamWriter($fs, [System.Text.UTF8Encoding]::new($false))
      $sw.Write($err)
      $sw.Dispose()
      $fs.Dispose()
    } catch {}
  }
  return $p.ExitCode
}

function Get-NewestSourceUtc {
  $paths = @(
    (Join-Path $root 'package.json'),
    (Join-Path $root 'package-lock.json'),
    (Join-Path $root 'nuxt.config.ts'),
    (Join-Path $root 'nuxt.config.js'),
    (Join-Path $root 'app.vue'),
    (Join-Path $root 'app.config.ts')
  )
  $dirs = @(
    'pages', 'components', 'composables', 'server', 'shared',
    'middleware', 'plugins', 'layouts', 'public', 'assets', 'utils'
  )
  $newest = [datetime]::MinValue
  foreach ($p in $paths) {
    if (Test-Path -LiteralPath $p -PathType Leaf) {
      $t = (Get-Item -LiteralPath $p).LastWriteTimeUtc
      if ($t -gt $newest) { $newest = $t }
    }
  }
  foreach ($d in $dirs) {
    $dirPath = Join-Path $root $d
    if (-not (Test-Path -LiteralPath $dirPath -PathType Container)) { continue }
    Get-ChildItem -LiteralPath $dirPath -Recurse -File -ErrorAction SilentlyContinue |
      Where-Object {
        $_.FullName -notmatch '[\\/]node_modules[\\/]' -and
        $_.FullName -notmatch '[\\/]\.git[\\/]' -and
        $_.FullName -notmatch '[\\/]\.output[\\/]' -and
        $_.FullName -notmatch '[\\/]data[\\/]'
      } |
      ForEach-Object {
        if ($_.LastWriteTimeUtc -gt $newest) { $newest = $_.LastWriteTimeUtc }
      }
  }
  return $newest
}

function Test-NeedsNpmInstall {
  $nm = Join-Path $root 'node_modules'
  if (-not (Test-Path -LiteralPath $nm -PathType Container)) { return $true }
  $lock = Join-Path $root 'package-lock.json'
  $pkg = Join-Path $root 'package.json'
  $marker = Join-Path $nm '.package-lock.json'
  if (-not (Test-Path -LiteralPath $marker -PathType Leaf)) {
    $marker = Join-Path $nm '.modules.yaml'
  }
  if (-not (Test-Path -LiteralPath $marker -PathType Leaf)) { return $true }
  $markerTime = (Get-Item -LiteralPath $marker).LastWriteTimeUtc
  foreach ($f in @($lock, $pkg)) {
    if ((Test-Path -LiteralPath $f -PathType Leaf) -and
      ((Get-Item -LiteralPath $f).LastWriteTimeUtc -gt $markerTime)) {
      return $true
    }
  }
  return $false
}

function Test-NeedsBuild {
  $index = Join-Path $root '.output\server\index.mjs'
  if (-not (Test-Path -LiteralPath $index -PathType Leaf)) { return $true }
  $buildTime = (Get-Item -LiteralPath $index).LastWriteTimeUtc
  $srcNewest = Get-NewestSourceUtc
  if ($srcNewest -gt $buildTime) { return $true }
  if (Test-Path -LiteralPath $stampPath -PathType Leaf) {
    $stampRaw = (Get-Content -LiteralPath $stampPath -Raw -ErrorAction SilentlyContinue).Trim()
    if ($stampRaw) {
      try {
        $stampTime = [datetime]::Parse($stampRaw, $null, [System.Globalization.DateTimeStyles]::RoundtripKind)
        if ($srcNewest -gt $stampTime) { return $true }
      } catch {}
    }
  }
  return $false
}

Write-StartupLog 'boot: a arrancar (com verificacao de alteracoes)'
Ensure-NodeOnPath

$needsInstall = Test-NeedsNpmInstall
$needsBuild = Test-NeedsBuild
$running = @(Get-ProductionNodeProcesses)
$wasRunning = $running.Count -gt 0

if ($needsInstall) {
  $rc = Invoke-LoggedNpm 'install'
  if ($rc -ne 0) {
    Write-StartupLog 'npm install falhou.' $errPath
    exit 1
  }
  $needsBuild = $true
}

if ($needsBuild) {
  if ($wasRunning) {
    Write-StartupLog 'alteracoes detectadas - a parar servidor antes do build'
    $null = Stop-ProductionVideoServer
    $wasRunning = $false
  }
  $rc = Invoke-LoggedNpm 'run build'
  if ($rc -ne 0) {
    Write-StartupLog 'npm run build falhou.' $errPath
    exit 1
  }
  try {
    Set-Content -LiteralPath $stampPath -Value ((Get-Date).ToUniversalTime().ToString('o')) -Encoding UTF8
  } catch {}
  Write-StartupLog 'build OK - a reiniciar servidor'
  $running = @()
} elseif ($wasRunning) {
  Write-StartupLog 'sem alteracoes relevantes - servidor ja activo; nada a fazer'
  try {
    Start-OutputWatchProcess $root $PSScriptRoot
    Write-StartupLog 'watch .output activo (reinicia sozinho apos npm run build)'
  } catch {
    Write-StartupLog ("AVISO - falha a arrancar watch .output: " + $_.Exception.Message)
  }
  exit 0
} else {
  Write-StartupLog 'build actualizado; servidor parado - a iniciar'
}

$index = Join-Path $root '.output\server\index.mjs'
if (-not (Test-Path -LiteralPath $index -PathType Leaf)) {
  Write-StartupLog 'build em falta apos verificacao.' $errPath
  exit 1
}

Write-StartupLog 'a iniciar npm run start (segundo plano)'
Write-StartupLog ("stdout/stderr do node em " + $runLogPath)
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = 'cmd.exe'
$psi.Arguments = '/c npm run start >> "' + $runLogPath + '" 2>&1'
$psi.WorkingDirectory = $root
$psi.UseShellExecute = $false
$psi.CreateNoWindow = $true
$psi.EnvironmentVariables['Path'] = $env:Path
[void][System.Diagnostics.Process]::Start($psi)

$up = $null
for ($i = 0; $i -lt 25; $i++) {
  Start-Sleep -Seconds 1
  $up = @(Get-ProductionNodeProcesses)
  if ($up.Count) { break }
}

if ($up -and $up.Count) {
  Write-StartupLog ("OK - servidor activo (PID " + $up[0].ProcessId + ")")
  try {
    Start-OutputWatchProcess $root $PSScriptRoot
    Write-StartupLog 'watch .output activo (reinicia sozinho apos npm run build)'
  } catch {
    Write-StartupLog ("AVISO - falha a arrancar watch .output: " + $_.Exception.Message)
  }
  exit 0
}

Write-StartupLog 'AVISO - nenhum node de producao apos 25s; ver startup-server.log' $errPath
exit 1
