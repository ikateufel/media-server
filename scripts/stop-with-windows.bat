@echo off
REM Para o Node de producao deste repo (start-with-windows), sem relancar.
REM Logs: data\stop-server.log (ou %%LOCALAPPDATA%%\video_player\data).
cd /d "%~dp0.."
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop-with-windows.ps1"
exit /b %ERRORLEVEL%
