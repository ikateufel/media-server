@echo off
setlocal
REM Uso: na pasta onde estao os .mp4/.mkv/..., corre este .cmd ou: tag-from-names.py ...
REM Grava data/file-lists/tags_<nome-da-pasta>.csv na raiz do projecto (pai de scripts/).

set "SCRIPT=%~dp0tag-from-names.py"
if not exist "%SCRIPT%" (
  echo Nao encontrado: "%SCRIPT%"
  exit /b 1
)

where python >nul 2>&1
if %ERRORLEVEL% equ 0 (
  python "%SCRIPT%" %*
  exit /b %ERRORLEVEL%
)
where py >nul 2>&1
if %ERRORLEVEL% equ 0 (
  py -3 "%SCRIPT%" %*
  exit /b %ERRORLEVEL%
)

echo Coloque Python no PATH ^(comando "python" ou "py"^).
exit /b 1
