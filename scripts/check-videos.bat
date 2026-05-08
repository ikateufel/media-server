@echo off
setlocal EnableExtensions
REM Pasta de trabalho da shell ANTES do pushd para a raiz do repo (senão %CD% seria sempre o projeto).
set "SCAN_DIR=%CD%"
REM =============================================================================
REM Verifica integridade dos videos (ffmpeg no PATH).
REM
REM   CMD ja na pasta dos videos:
REM        scripts\check-videos.bat
REM        scripts\check-videos.bat delete          REM corruptos -> lixeira (depois 0 problemas e' normal)
REM        scripts\check-videos.bat -r             REM inclui subpastas
REM        scripts\check-videos.bat delete -r       REM igual ao primeiro scan recursivo
REM
REM   Pasta explicita (caminho absoluto):
REM        check-videos.bat "%USERPROFILE%\Videos\minha-pasta"
REM
REM Modo rapido: na raiz do projecto  npm run check-videos -- --dir="..." --quick
REM =============================================================================

pushd "%~dp0.." 2>nul || (
  echo [ERRO] Pasta do projecto invalida: %~dp0..
  exit /b 1
)

REM Sem argumentos: pasta onde invocaste o .bat (nao o repo apos pushd)
if "%~1"=="" (
  call npx tsx scripts/check-videos-integrity.ts --dir="%SCAN_DIR%"
  goto :POP
)

REM delete primeiro -> SCAN_DIR + flags extra
if /I "%~1"=="delete" (
  call npx tsx scripts/check-videos-integrity.ts --dir="%SCAN_DIR%" %*
  goto :POP
)

REM -r primeiro -> SCAN_DIR recursivo + flags extra
if /I "%~1"=="-r" (
  call npx tsx scripts/check-videos-integrity.ts --dir="%SCAN_DIR%" %*
  goto :POP
)
if /I "%~1"=="--recursive" (
  call npx tsx scripts/check-videos-integrity.ts --dir="%SCAN_DIR%" %*
  goto :POP
)

REM --quick primeiro -> SCAN_DIR
if /I "%~1"=="--quick" (
  call npx tsx scripts/check-videos-integrity.ts --dir="%SCAN_DIR%" %*
  goto :POP
)

REM Primeiro argumento = pasta
call npx tsx scripts/check-videos-integrity.ts --dir="%~f1" %~2 %~3 %~4 %~5 %~6 %~7 %~8 %~9

:POP
set "EC=%ERRORLEVEL%"
popd
exit /b %EC%
