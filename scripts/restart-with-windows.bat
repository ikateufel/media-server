@echo off
REM Para o Node de producao deste repo e volta a arrancar via start-with-windows.vbs.
REM Logs: data\restart-server.log (ou %%LOCALAPPDATA%%\video_player\data).
cd /d "%~dp0.."
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0restart-with-windows.ps1"
exit /b %ERRORLEVEL%
