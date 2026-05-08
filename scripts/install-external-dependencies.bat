@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-external-dependencies.ps1"
exit /b %errorlevel%
