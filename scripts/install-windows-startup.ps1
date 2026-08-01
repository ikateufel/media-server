#Requires -Version 5.1
<#
  Cria atalho na pasta Inicialização do utilizador actual.
  Arranque: start-with-windows.vbs -> start-with-windows.ps1
  (rebuild + reinicio automatico se o codigo mudou desde o ultimo build).
  Executar na raiz: powershell -ExecutionPolicy Bypass -File scripts\install-windows-startup.ps1
#>
$ErrorActionPreference = 'Stop'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$vbsPath = Join-Path $scriptDir 'start-with-windows.vbs'
if (-not (Test-Path -LiteralPath $vbsPath)) {
  Write-Error "Nao encontrado: $vbsPath"
}
$wscript = Join-Path $env:SystemRoot 'System32\wscript.exe'
if (-not (Test-Path -LiteralPath $wscript)) {
  Write-Error "Nao encontrado: $wscript"
}
$startup = [Environment]::GetFolderPath('Startup')
$lnkPath = Join-Path $startup 'Video Player (local).lnk'
$wsh = New-Object -ComObject WScript.Shell
$sc = $wsh.CreateShortcut($lnkPath)
$sc.TargetPath = $wscript
$sc.Arguments = "`"$vbsPath`""
$sc.WorkingDirectory = $scriptDir
$sc.Description = 'Video Player — arranque com rebuild se houver alteracoes'
$sc.WindowStyle = 7
$sc.Save()
Write-Host "Atalho criado: $lnkPath"
Write-Host "Para remover: powershell -File scripts\uninstall-windows-startup.ps1"
