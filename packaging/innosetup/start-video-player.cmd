@echo off
setlocal EnableExtensions
cd /d "%~dp0"

if not exist ".output\server\index.mjs" (
  echo [Video Player] Falta o servidor compilado em .output\ — reinstale o pacote.
  pause
  exit /b 1
)

where node >nul 2>&1
if errorlevel 1 (
  echo [Video Player] Node.js nao encontrado no PATH.
  echo Instale Node.js 22 ou superior: https://nodejs.org/
  pause
  exit /b 1
)

rem Carrega .env na pasta actual se existir (Node 22+). Tambem podes definir variaveis no sistema.
node --env-file-if-exists=.env .output\server\index.mjs
set EXITCODE=%ERRORLEVEL%
if not "%EXITCODE%"=="0" (
  echo Servidor terminou com erro %EXITCODE%.
  pause
)
exit /b %EXITCODE%
