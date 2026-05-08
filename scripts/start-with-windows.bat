@echo off
setlocal
cd /d "%~dp0.."
set "ROOT=%CD%"

if not exist "data\" mkdir "data"

set "LOG=data\startup-server.log"
set "ERR=data\startup-error.log"

call :log "boot: a arrancar"

if not exist "node_modules\" (
  call :log "node_modules em falta. A correr npm install..."
  call npm install >>"%LOG%" 2>&1
  if errorlevel 1 (
    call :err "npm install falhou."
    exit /b 1
  )
)

if not exist ".output\server\index.mjs" (
  call :log "build em falta. A correr npm run build..."
  call npm run build >>"%LOG%" 2>&1
  if errorlevel 1 (
    call :err "build falhou."
    exit /b 1
  )
)

call :log "a iniciar npm run start (processo separado — pode fechar esta janela)"
REM Sem /B: novo processo na sua propria consola; ao fechar ESTA janela o servidor nao morre.
REM /MIN minimiza a consola do Node (podes fechar pelo icone na barra de tarefas / Gestor de tarefas).
start "" /MIN cmd /c "cd /d \"%ROOT%\" && npm run start >> \"%ROOT%\data\startup-server.log\" 2>&1"
exit /b 0

:log
echo [%date% %time%] %~1 >>"%ROOT%\%LOG%"
exit /b 0

:err
echo [%date% %time%] %~1 >>"%ROOT%\%ERR%"
exit /b 0
