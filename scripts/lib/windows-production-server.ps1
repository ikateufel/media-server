# Funcoes partilhadas: parar o servidor `npm run start` (start-with-windows).

$script:ProductionIndexPattern = '\.output[\\/]server[\\/]index\.mjs'

function Get-ProductionNodeProcesses {
  Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object {
    $_.CommandLine -and $_.CommandLine -match $script:ProductionIndexPattern
  }
}

function Test-ShouldKillProductionParent($parent) {
  if (-not $parent -or -not $parent.CommandLine) { return $false }
  $cmd = $parent.CommandLine
  if ($parent.Name -eq 'node.exe' -and $cmd -match 'npm(-cli)?\.js.*run start') { return $true }
  if ($parent.Name -eq 'cmd.exe' -and $cmd -match 'npm run start') { return $true }
  return $false
}

function Get-ProductionProcessTreeIds([int]$leafPid) {
  $ids = [System.Collections.Generic.HashSet[int]]::new()
  [void]$ids.Add($leafPid)
  $walk = $leafPid
  for ($i = 0; $i -lt 6; $i++) {
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId = $walk" -ErrorAction SilentlyContinue
    if (-not $proc) { break }
    $parentId = $proc.ParentProcessId
    if (-not $parentId -or $parentId -le 0) { break }
    $parent = Get-CimInstance Win32_Process -Filter "ProcessId = $parentId" -ErrorAction SilentlyContinue
    if (-not $parent) { break }
    if (Test-ShouldKillProductionParent $parent) {
      [void]$ids.Add($parent.ProcessId)
      $walk = $parentId
      continue
    }
    break
  }
  return $ids
}

function Stop-ProductionVideoServer {
  $nodes = @(Get-ProductionNodeProcesses)
  $pidsToKill = [System.Collections.Generic.HashSet[int]]::new()
  foreach ($n in $nodes) {
    foreach ($id in (Get-ProductionProcessTreeIds $n.ProcessId)) {
      [void]$pidsToKill.Add($id)
    }
  }

  if (-not $pidsToKill.Count) {
    return @{ Stopped = 0; Remaining = 0 }
  }

  foreach ($id in ($pidsToKill | Sort-Object)) {
    Stop-Process -Id $id -Force -ErrorAction SilentlyContinue
  }
  Start-Sleep -Seconds 2

  $left = @(Get-ProductionNodeProcesses)
  if ($left.Count) {
    foreach ($n in $left) {
      Stop-Process -Id $n.ProcessId -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Seconds 1
    $left = @(Get-ProductionNodeProcesses)
  }

  return @{ Stopped = $pidsToKill.Count; Remaining = $left.Count }
}

function Get-ProductionServerLogDir([string]$root) {
  $logDir = Join-Path $root 'data'
  if (-not (Test-Path $logDir -PathType Container)) {
    $logDir = Join-Path $env:LOCALAPPDATA 'video_player\data'
    if (-not (Test-Path $logDir -PathType Container)) {
      New-Item -ItemType Directory -Path $logDir -Force | Out-Null
    }
  }
  return $logDir
}
