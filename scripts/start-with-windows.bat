@echo off
REM Delega para start-with-windows.vbs (execucao sem janela de consola).
REM Logs: data\startup-server.log (ou %LOCALAPPDATA%\video_player\data se sem permissoes na pasta do repo).
REM Parar: scripts\stop-with-windows.bat  (ou npm run stop:windows)
REM Reiniciar: scripts\restart-with-windows.bat  (ou npm run restart:windows)
REM Atalho de arranque: corre install-autostart.bat ou install-windows-startup.ps1 (ambos usam o .vbs).
wscript.exe //nologo "%~dp0start-with-windows.vbs"
exit /b %ERRORLEVEL%
