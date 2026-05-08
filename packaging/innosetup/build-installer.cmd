@echo off
setlocal
cd /d "%~dp0..\.."
echo [1/2] npm run build...
call npm run build
if errorlevel 1 (
  echo Build falhou.
  exit /b 1
)
echo.
echo [2/2] No Inno Setup: File ^> Open ^>  packaging\innosetup\video-player.iss
echo         Build ^> Compile.  Instalador: packaging\dist\VideoPlayer-Setup.exe
echo.
exit /b 0
