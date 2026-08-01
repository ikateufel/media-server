# Para o servidor `npm run start` deste repo e relanca start-with-windows.ps1.

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

$ps1 = Join-Path $PSScriptRoot 'start-with-windows.ps1'
if (Test-Path -LiteralPath $ps1) {
  Write-RestartLog 'restart: a relancar start-with-windows.ps1'
  $p = Start-Process -FilePath 'powershell.exe' -ArgumentList @(
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', $ps1
  ) -Wait -PassThru -WindowStyle Hidden
  exit $p.ExitCode
}

Write-RestartLog 'restart: a relancar start-with-windows.vbs'
Start-Process -FilePath 'wscript.exe' -ArgumentList @('//nologo', $vbs) -WindowStyle Hidden | Out-Null
exit 0
