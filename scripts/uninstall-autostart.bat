@echo off
setlocal
set "STARTUP_DIR=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "SHORTCUT=%STARTUP_DIR%\video_player.lnk"

if exist "%SHORTCUT%" (
  del "%SHORTCUT%"
  echo [ok] Atalho removido: %SHORTCUT%
) else (
  echo [info] Nao havia atalho em %SHORTCUT%
)
endlocal
exit /b 0
