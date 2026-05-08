@echo off
REM Arranca o servidor de producao (npm run start) minimizado.
REM - Executa desde qualquer lado: faz cd para a raiz do repo (%~dp0..).
REM - Se aparecer erro de aspas/antigo: garante que atualizaste este ficheiro (usa start /D ...).
REM - Depois do arranque, verifica data\startup-server.log e porta (por defeito 3000)
REM - Para debug, edita abaixo e tira /MIN para ver a consola do Node.
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
REM /D define o working directory (evita erro de quoting com cd + caminhos com espacos).
REM Sem /MIN podes tirar para ver erros na consola do Node.
REM A saida vai para startup-server.log; erros também (2>&1).
start "" /MIN /D "%ROOT%" cmd /c "npm run start >> data\startup-server.log 2>&1"
exit /b 0

:log
echo [%date% %time%] %~1 >>"%ROOT%\%LOG%"
exit /b 0

:err
echo [%date% %time%] %~1 >>"%ROOT%\%ERR%"
exit /b 0
