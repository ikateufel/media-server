@echo off
setlocal
title flatten - videos das subpastas -^> raiz
::
:: Move ficheiros de video (.mp4, .mkv, .avi, etc.) de todas as subpastas
:: para a pasta em que este .bat corre (ou a pasta que passar como argumento).
::
:: Pastas ignoradas no caminho: trailers, preview, .thumb_cache, incoming, node_modules, .git, .nuxt, dist, output
::
:: Uso:
::   flatten-videos.bat
::   flatten-videos.bat "%USERPROFILE%\Videos\minha-pasta"
::   flatten-videos.bat "%USERPROFILE%\Videos\minha-pasta" -WhatIf
::   set ROOT=%USERPROFILE%\Videos\minha-pasta
::   flatten-videos.bat
::
if defined ROOT cd /d "%ROOT%" 2>nul

set "WHATIF="
:argloop
if "%~1"=="" goto :argdone
if /i "%~1"=="-WhatIf" (
  set "WHATIF=-WhatIf"
  shift
  goto :argloop
)
cd /d "%~1" 2>nul
if errorlevel 1 (
  echo ERRO: nao consegui cd para "%~1"
  pause
  exit /b 1
)
shift
goto :argloop

:argdone
set "ROOT_ARG=%CD%"

set "PSFILE=%~dp0flatten-videos.ps1"
if not exist "%PSFILE%" (
  echo ERRO: nao encontrei flatten-videos.ps1 em %~dp0
  pause
  exit /b 1
)

echo Raiz: %ROOT_ARG%
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%PSFILE%" -Root "%ROOT_ARG%" %WHATIF%
set "EC=%ERRORLEVEL%"
echo.
if not "%SKIP_PAUSE%"=="1" pause
exit /b %EC%
