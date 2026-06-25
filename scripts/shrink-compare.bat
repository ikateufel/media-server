@echo off

setlocal

title shrink-compare - pre_selected vs shrinked

::

:: Classifica quem precisa de 2.ª ou 3.ª passagem (ja com shrinked\).

:: Grava data\shrink-multipass.txt (2|nome / 3|nome), phase2-only, phase3, reprocess.

::

:: Uso: shrink-compare.bat "H:\temp\note_h\new\pre_selected"

::

set "SCRIPT_DIR=%~dp0"

set "ROOT="

set "WHATIF="



:argloop

if "%~1"=="" goto :argdone

if /i "%~1"=="-WhatIf" (

  set "WHATIF=-WhatIf"

  shift

  goto :argloop

)

set "ROOT=%~1"

shift

goto :argloop



:argdone

if not defined ROOT (

  echo Uso: shrink-compare.bat [-WhatIf] "H:\...\pre_selected"

  if not "%SKIP_PAUSE%"=="1" pause

  exit /b 1

)



set "PSFILE=%SCRIPT_DIR%vp-shrink-insufficient.ps1"

if not exist "%PSFILE%" (

  echo ERRO: nao encontrei vp-shrink-insufficient.ps1 em %SCRIPT_DIR%

  if not "%SKIP_PAUSE%"=="1" pause

  exit /b 1

)



for %%I in ("%SCRIPT_DIR%..") do set "REPO_ROOT=%%~fI"



echo Pasta: %ROOT%

echo.



powershell -NoProfile -ExecutionPolicy Bypass -File "%PSFILE%" -Root "%ROOT%" -RepoRoot "%REPO_ROOT%" %WHATIF%

set "EC=%ERRORLEVEL%"

echo.

if not "%SKIP_PAUSE%"=="1" pause

exit /b %EC%

