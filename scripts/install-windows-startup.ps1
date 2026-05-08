#Requires -Version 5.1
<#
  Cria atalho na pasta Inicialização do utilizador actual para arrancar o servidor
  (scripts\start-with-windows.bat) ao iniciar sessão no Windows.
  Executar na raiz do projecto: powershell -ExecutionPolicy Bypass -File scripts\install-windows-startup.ps1
#>
$ErrorActionPreference = 'Stop'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = (Resolve-Path (Join-Path $scriptDir '..')).Path
$batPath = Join-Path $scriptDir 'start-with-windows.bat'
if (-not (Test-Path -LiteralPath $batPath)) {
  Write-Error "Nao encontrado: $batPath"
}
$startup = [Environment]::GetFolderPath('Startup')
$lnkPath = Join-Path $startup 'Video Player (local).lnk'
$wsh = New-Object -ComObject WScript.Shell
$sc = $wsh.CreateShortcut($lnkPath)
$sc.TargetPath = $batPath
$sc.WorkingDirectory = $projectRoot
$sc.Description = 'Reprodutor de video — Nuxt (npm run start)'
$sc.WindowStyle = 7
$sc.Save()
Write-Host "Atalho criado: $lnkPath"
Write-Host "Para remover: powershell -File scripts\uninstall-windows-startup.ps1"
