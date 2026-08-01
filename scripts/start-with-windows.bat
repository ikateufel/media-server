@echo off
REM Delega para start-with-windows.vbs -> start-with-windows.ps1
REM No arranque: se houver alteracao no codigo, faz npm install/build e reinicia o servidor.
REM Logs: data\startup-server.log (ou %LOCALAPPDATA%\video_player\data).
REM Parar: scripts\stop-with-windows.bat | Reiniciar: scripts\restart-with-windows.bat
REM Atalho: install-autostart.bat ou install-windows-startup.ps1
wscript.exe //nologo "%~dp0start-with-windows.vbs"
exit /b %ERRORLEVEL%
