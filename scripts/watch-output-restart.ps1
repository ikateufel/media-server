# Observa .output e reinicia `npm run start` quando o build muda.
# Arrancado em segundo plano por start-with-windows.ps1.

$ErrorActionPreference = 'Continue'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location -LiteralPath $root
. (Join-Path $PSScriptRoot 'lib\windows-production-server.ps1')

$logDir = Get-ProductionServerLogDir $root
$logPath = Join-Path $logDir 'output-watch.log'
$pidPath = Join-Path $logDir 'output-watch.pid'
$indexPath = Join-Path $root '.output\server\index.mjs'
$debounceSec = 4

function Write-WatchLog([string]$msg) {
  $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $msg"
  try {
    Add-Content -LiteralPath $logPath -Value $line -Encoding UTF8
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

function Get-NewestUtc([string]$path) {
  if (-not (Test-Path -LiteralPath $path)) { return $null }
  $item = Get-Item -LiteralPath $path -ErrorAction SilentlyContinue
  if (-not $item) { return $null }
  return $item.LastWriteTimeUtc
}

function Get-OutputStamp {
  $parts = New-Object System.Collections.Generic.List[string]
  $targets = @(
    (Join-Path $root '.output\server\index.mjs'),
    (Join-Path $root '.output\server\package.json'),
    (Join-Path $root '.output\nitro.json'),
    (Join-Path $root '.output\public\index.html')
  )
  foreach ($t in $targets) {
    if (Test-Path -LiteralPath $t -PathType Leaf) {
      $i = Get-Item -LiteralPath $t
      $parts.Add(('{0}:{1:o}:{2}' -f $i.Name, $i.LastWriteTimeUtc, $i.Length))
    }
  }

  $scanDirs = @(
    (Join-Path $root '.output\server\chunks\routes'),
    (Join-Path $root '.output\server\chunks\build'),
    (Join-Path $root '.output\public\_nuxt')
  )
  foreach ($dir in $scanDirs) {
    if (-not (Test-Path -LiteralPath $dir -PathType Container)) { continue }
    $newest = $null
    Get-ChildItem -LiteralPath $dir -Recurse -File -ErrorAction SilentlyContinue |
      ForEach-Object {
        if (-not $newest -or $_.LastWriteTimeUtc -gt $newest.LastWriteTimeUtc) {
          $newest = $_
        }
      }
    if ($newest) {
      $parts.Add(('{0}:{1:o}:{2}' -f $newest.FullName.Substring($root.Length), $newest.LastWriteTimeUtc, $newest.Length))
    }
  }

  if ($parts.Count -eq 0) { return $null }
  return ($parts -join '|')
}

function Start-ProductionServer {
  Ensure-UserPath
  if (-not (Test-Path -LiteralPath $indexPath -PathType Leaf)) {
    Write-WatchLog 'index.mjs em falta - nao reinicio'
    return $false
  }
  $runLogPath = Join-Path $logDir 'startup-node.log'
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = 'cmd.exe'
  $psi.Arguments = '/c npm run start >> "' + $runLogPath + '" 2>&1'
  $psi.WorkingDirectory = $root
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.EnvironmentVariables['Path'] = $env:Path
  [void][System.Diagnostics.Process]::Start($psi)
  for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 1
    $up = @(Get-ProductionNodeProcesses)
    if ($up.Count) {
      Write-WatchLog ("servidor activo PID " + $up[0].ProcessId)
      return $true
    }
  }
  Write-WatchLog 'AVISO: servidor nao subiu apos restart'
  return $false
}

function Restart-ProductionFromWatch {
  Write-WatchLog 'alteracao em .output - a reiniciar npm run start'
  $null = Stop-ProductionVideoServer
  Start-Sleep -Seconds 1
  [void](Start-ProductionServer)
}

try {
  Set-Content -LiteralPath $pidPath -Value $PID -Encoding ASCII
} catch {}

Write-WatchLog ("watch activo na pasta $root (PID $PID)")
$stableStamp = Get-OutputStamp
$pendingStamp = $null
$pendingSince = $null
Write-WatchLog ('stamp inicial: ' + $(if ($stableStamp) { $stableStamp.Substring(0, [Math]::Min(120, $stableStamp.Length)) } else { '(vazio)' }))

while ($true) {
  Start-Sleep -Seconds 1
  try {
    $cur = Get-OutputStamp

    if ($null -eq $cur) {
      if ($null -ne $stableStamp) {
        Write-WatchLog 'build em curso (.output incompleto)'
        $pendingStamp = 'missing'
        $pendingSince = Get-Date
        $stableStamp = $null
      }
      continue
    }

    if ($null -eq $stableStamp) {
      $pendingStamp = $cur
      if ($null -eq $pendingSince) { $pendingSince = Get-Date }
    } elseif ($cur -ne $stableStamp) {
      if ($pendingStamp -ne $cur) {
        Write-WatchLog 'mudanca detectada em .output'
        $pendingStamp = $cur
        $pendingSince = Get-Date
      }
    } else {
      $pendingStamp = $null
      $pendingSince = $null
      continue
    }

    if ($null -eq $pendingSince -or $null -eq $pendingStamp -or $pendingStamp -eq 'missing') { continue }
    if ($cur -ne $pendingStamp) { continue }
    $waited = ((Get-Date) - $pendingSince).TotalSeconds
    if ($waited -lt $debounceSec) { continue }

    $stableStamp = $cur
    $pendingStamp = $null
    $pendingSince = $null
    Restart-ProductionFromWatch
    $stableStamp = Get-OutputStamp
  } catch {
    Write-WatchLog ("erro no watch: " + $_.Exception.Message)
    Start-Sleep -Seconds 2
  }
}
