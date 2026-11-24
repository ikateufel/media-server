@echo off
chcp 65001 >nul
setlocal
where node >nul 2>nul
if errorlevel 1 (
    echo [ERRO] Node.js nao encontrado no PATH.
    if "%~1"=="" pause
    exit /b 1
)
node "%~dp0shrink-downloaded.mjs" %*
set "RC=%ERRORLEVEL%"
if "%~1"=="" pause
exit /b %RC%
