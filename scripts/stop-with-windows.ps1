# Para o servidor `npm run start` arrancado por start-with-windows (sem relancar).

$ErrorActionPreference = 'Continue'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
. (Join-Path $PSScriptRoot 'lib\windows-production-server.ps1')

$logPath = Join-Path (Get-ProductionServerLogDir $root) 'stop-server.log'

function Write-StopLog([string]$msg) {
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
  Write-StopLog 'stop: nenhum node com .output/server/index.mjs encontrado'
  exit 0
}

Write-StopLog ("stop: parados " + $result.Stopped + " processo(s)")
if ($result.Remaining -gt 0) {
  Write-StopLog ("stop: AVISO - ainda ha " + $result.Remaining + " processo(s)")
  exit 1
}

Write-StopLog 'stop: OK - servidor parado'
exit 0
