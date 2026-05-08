#Requires -Version 5.1
$startup = [Environment]::GetFolderPath('Startup')
$lnkPath = Join-Path $startup 'Video Player (local).lnk'
if (Test-Path -LiteralPath $lnkPath) {
  Remove-Item -LiteralPath $lnkPath -Force
  Write-Host "Removido: $lnkPath"
} else {
  Write-Host "Nada a remover: $lnkPath"
}
