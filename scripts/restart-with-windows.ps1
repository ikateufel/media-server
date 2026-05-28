# Para o servidor `npm run start` deste repo e relanca start-with-windows.vbs.

$ErrorActionPreference = 'Continue'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$vbs = Join-Path $PSScriptRoot 'start-with-windows.vbs'
. (Join-Path $PSScriptRoot 'lib\windows-production-server.ps1')

$logPath = Join-Path (Get-ProductionServerLogDir $root) 'restart-server.log'

function Write-RestartLog([string]$msg) {
  $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $msg"
  try {
    Add-Content -LiteralPath $logPath -Value $line -Encoding UTF8
  } catch {
    Write-Warning "Nao foi possivel escrever em $logPath : $_"
  }
  Write-Host $line
}

$result = Stop-ProductionVideoServer

if ($result.Stopped -eq 0) {
  Write-RestartLog 'restart: nenhum node com .output/server/index.mjs encontrado'
} else {
  Write-RestartLog ("restart: parados " + $result.Stopped + " processo(s)")
  if ($result.Remaining -gt 0) {
    Write-RestartLog ("restart: AVISO - ainda ha " + $result.Remaining + " processo(s) antes de relancar")
  }
}

Write-RestartLog 'restart: a relancar start-with-windows.vbs'
Start-Process -FilePath 'wscript.exe' -ArgumentList @('//nologo', $vbs) -WindowStyle Hidden | Out-Null

$up = $null
for ($i = 0; $i -lt 25; $i++) {
  Start-Sleep -Seconds 1
  $up = @(Get-ProductionNodeProcesses)
  if ($up.Count) { break }
}

if ($up -and $up.Count) {
  Write-RestartLog ("restart: OK - servidor activo (PID " + $up[0].ProcessId + ")")
  exit 0
}

Write-RestartLog 'restart: AVISO - nenhum node de producao apos 25s; ver data\startup-server.log'
exit 1
