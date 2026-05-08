@echo off

setlocal EnableDelayedExpansion
:: Corre na pasta da biblioteca (onde estao os videos e trailers\), igual a trailer.bat / preview.bat.
:: Move para analyze\ os ficheiros na raiz SEM trailer em trailers\.
:: Trailer existe se: trailers\<stem>.mp4 OU trailers\zz_<stem>_acelerado.mp4
:: Ignora na raiz: zz_*, preview.*
::
:: Opcional: antes de correr, na mesma janela cmd: set LIST_ONLY=1  (so lista, nao move)
:: Opcional: set SKIP_PAUSE=1  (sem pause no fim)
if not defined LIST_ONLY set "LIST_ONLY=0"
if not defined SKIP_PAUSE set "SKIP_PAUSE=0"

if not exist "trailers\" (
    echo [ERRO] Sem pasta trailers\ nesta pasta: %CD%
    exit /b 1
)

if not exist "analyze\" mkdir "analyze"

echo ====================================================
echo   ANALYZE-NO-TRAILER
echo   %CD%
if "!LIST_ONLY!"=="1" (echo   LIST_ONLY=1 ^(so lista^)) else (echo   mover para analyze\)
echo ====================================================

set /a MOVED=0
set /a LISTED=0

for %%X in (mp4 mkv avi mov webm m4v mpeg mpg m2ts mts 3gp) do (
    for %%F in (*.%%X) do call :process "%%F"
)

echo.
if "!LIST_ONLY!"=="1" (
    echo Resumo: !LISTED! sem trailer ^(LIST_ONLY=1, nada movido^).
) else (
    echo Resumo: !MOVED! movido^(s^) para analyze\ ^(!LISTED! sem trailer^).
)
echo ====================================================

if not "%SKIP_PAUSE%"=="1" pause

endlocal
exit /b 0

:process
set "FILE=%~nx1"
set "STEM=%~n1"
echo "!FILE!" | findstr /I /R "^zz_" >nul
if not errorlevel 1 exit /b 0
echo "!FILE!" | findstr /I /R "^preview\." >nul
if not errorlevel 1 exit /b 0

if exist "trailers\%STEM%.mp4" exit /b 0
if exist "trailers\zz_%STEM%_acelerado.mp4" exit /b 0

set /a LISTED+=1
if "!LIST_ONLY!"=="1" (
    echo [LIST] !FILE!
    exit /b 0
)
if exist "analyze\!FILE!" (
    echo [SKIP] analyze\!FILE! ja existe
    exit /b 0
)
move /Y "!FILE!" "analyze\!FILE!" >nul
if not errorlevel 1 (
    echo [OK] analyze\!FILE!
    set /a MOVED+=1
) else (
    echo [ERRO] mover !FILE!
)
exit /b 0
