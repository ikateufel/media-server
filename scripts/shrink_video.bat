@echo off

setlocal DisableDelayedExpansion
:: Encurta UM video completo (sem cortes). Saida fixa em shrinked\
:: Reduz altura so se origem for maior que o alvo (origem menor = mantem resolucao).
::
:: Uso (correr na pasta da biblioteca, como trailer.bat):
::   shrink_video.bat "filme.mkv"
::   shrink_video.bat "filme.mkv" 480
::   shrink_video.bat --speed=1.5 "filme.mkv"
::   shrink_video.bat 480 1.5 "filme.mkv"
::   shrink_video.bat --height=720 --speed=1.25 "filme.mkv"
::   shrink_video.bat --force "filme.mkv"

set "vel=1.5"
set "H_OUT=540"
set "OUT_DIR=shrinked"
set "VIDEO_IN="
set "FORCE=0"
set "SKIP_PAUSE=1"
set "USE_NVENC=auto"
if not defined TRAILER_NVENC_PRESET set "TRAILER_NVENC_PRESET=p4"
if not defined TEMP set "TEMP=C:\Windows\Temp"

set "VP_SCRIPTS_DIR=%~dp0"
if exist "%CD%\shrink_video.env.bat" call "%CD%\shrink_video.env.bat"
if exist "%~dp0shrink_video.env.bat" call "%~dp0shrink_video.env.bat"
if not exist "%VP_SCRIPTS_DIR%ffmpeg-on-path.bat" (
    if defined VIDEO_PLAYER_ROOT set "VP_SCRIPTS_DIR=%VIDEO_PLAYER_ROOT%\scripts\"
)
if not exist "%VP_SCRIPTS_DIR%ffmpeg-on-path.bat" goto :ffmpeg_on_path_missing
for %%_ in ("%VP_SCRIPTS_DIR%..") do set "VP_REPO_ROOT=%%~f_"
goto :ffmpeg_on_path_ok

:ffmpeg_on_path_missing
echo [ERRO] ffmpeg-on-path.bat nao encontrado.
echo.
echo Corra o script a partir do repo ^(recomendado^):
echo   cd H:\temp\note_h\downloaded
echo   G:\User\Projetos\video_player\scripts\shrink_video.bat "filme.mkv"
echo.
echo Ou defina VIDEO_PLAYER_ROOT ^(variavel de ambiente^) ou crie shrink_video.env.bat:
echo   set "VIDEO_PLAYER_ROOT=G:\User\Projetos\video_player"
echo ^(ver scripts\shrink_video.env.example.bat^)
exit /b 1

:ffmpeg_on_path_ok

if /I "%~1"=="--help" goto :show_help
if /I "%~1"=="-h" goto :show_help
if /I "%~1"=="help" goto :show_help
if "%~1"=="" goto :missing_video

:parse_args
if "%~1"=="" goto :args_done
if /I "%~1"=="--force" (
    set "FORCE=1"
    shift
    goto :parse_args
)
if /I "%~1"=="--height" (
    if "%~2"=="" (
        echo [ERRO] --height requer um valor.
        exit /b 1
    )
    set "H_OUT=%~2"
    shift
    shift
    goto :parse_args
)
echo %~1| findstr /R /C:"^--height=" >nul && (
    for /f "tokens=2 delims==" %%H in ("%~1") do set "H_OUT=%%H"
    shift
    goto :parse_args
)
if /I "%~1"=="--speed" (
    if "%~2"=="" (
        echo [ERRO] --speed requer um valor ^(1.25, 1.5 ou 2^).
        exit /b 1
    )
    call :apply_speed "%~2"
    if errorlevel 1 exit /b 1
    shift
    shift
    goto :parse_args
)
echo %~1| findstr /R /C:"^--speed=" >nul && (
    for /f "tokens=2 delims==" %%S in ("%~1") do (
        call :apply_speed "%%S"
        if errorlevel 1 exit /b 1
    )
    shift
    goto :parse_args
)
call :try_speed_token "%~1"
if errorlevel 2 (
    shift
    goto :parse_args
)
echo %~1| findstr /R "^[0-9][0-9]*$" >nul && (
    set "H_OUT=%~1"
    shift
    goto :parse_args
)
if defined VIDEO_IN (
    echo [ERRO] Argumento extra: %~1
    echo        Indique so um video. Ver: shrink_video.bat --help
    exit /b 1
)
set "VIDEO_IN=%~1"
shift
goto :parse_args

:args_done
if not defined VIDEO_IN goto :missing_video
if not exist "%VIDEO_IN%" (
    echo [ERRO] Video nao encontrado: %VIDEO_IN%
    exit /b 1
)
if %H_OUT% LSS 144 (
    echo [ERRO] Altura invalida: %H_OUT% ^(minimo 144^)
    exit /b 1
)
if %H_OUT% GTR 4320 (
    echo [ERRO] Altura invalida: %H_OUT% ^(maximo 4320^)
    exit /b 1
)

for %%F in ("%VIDEO_IN%") do (
    set "ORIG=%%~fF"
    set "NOME=%%~nF"
)

echo ====================================================
echo   SHRINK-VIDEO v1.3 — video completo ^(%vel%x, sem cortes^)
echo   Entrada: %ORIG%
echo   Altura alvo: %H_OUT% px  ^|  Velocidade: %vel%x  ^|  Saida: %OUT_DIR%\%NOME%.mp4
echo   setpts=PTS/%vel%, atempo=%vel%
echo ====================================================

if not exist "%VP_REPO_ROOT%\data" mkdir "%VP_REPO_ROOT%\data" 2>nul
if not exist "%OUT_DIR%" mkdir "%OUT_DIR%" 2>nul

if "%FORCE%"=="0" if exist "%OUT_DIR%\%NOME%.mp4" (
    echo [SKIP] Ja existe: %OUT_DIR%\%NOME%.mp4 ^(use --force para substituir^)
    exit /b 0
)

echo %ORIG%| findstr /I /C:"\shrinked\" >nul && (
    echo [SKIP] origem em pasta shrinked: %ORIG%
    exit /b 0
)

pushd "%VP_SCRIPTS_DIR%"
call ffmpeg-on-path.bat
set "RC=%errorlevel%"
popd
if %RC% NEQ 0 (
    if not "%SKIP_PAUSE%"=="1" pause
    exit /b %RC%
)

if "%FORCE%"=="0" (
    call :probe_tag_speed "%ORIG%" TAG_SPEED
    if defined TAG_SPEED (
        echo [SKIP] ja shrinkado ^(vp_shrink_speed=%TAG_SPEED%^): %ORIG%
        exit /b 0
    )
)

set "VENC_ARGS=-c:v libx264 -preset superfast -tune zerolatency"
if /I "%USE_NVENC%"=="1" goto :pick_nvenc
if /I not "%USE_NVENC%"=="auto" goto :encoder_done
"%FFMPEG%" -hide_banner -loglevel error -f lavfi -i color=c=black:s=256x144:r=1 -frames:v 1 -c:v h264_nvenc -f null NUL >nul 2>&1
if errorlevel 1 (
    echo [INFO] NVENC indisponivel - a usar libx264 ^(CPU^).
    goto :encoder_done
)
:pick_nvenc
set "VENC_ARGS=-c:v h264_nvenc -preset %TRAILER_NVENC_PRESET% -rc vbr -cq 26 -b:v 0"
echo [INFO] Encoder de video: h264_nvenc preset %TRAILER_NVENC_PRESET%.
:encoder_done

setlocal EnableDelayedExpansion

set "orig=%ORIG%"
set "nome=%NOME%"
set "outFile=%OUT_DIR%\%NOME%.mp4"

echo.
echo [PROCESSANDO] !orig!
>>"%VP_REPO_ROOT%\data\sync-bat-processing.log" echo !orig!

set "HAS_A=0"
call :probe_has_audio "!orig!" HAS_A

set "SRC_H="
call :probe_video_height "!orig!" SRC_H

set "H_EFFECTIVE=!H_OUT!"
set "SCALE_MODE=1"

if defined SRC_H (
    if !SRC_H! LSS !H_OUT! set "H_EFFECTIVE=!SRC_H!"
    if !SRC_H! LEQ !H_OUT! set "SCALE_MODE=0"
)

set "AF_CHAIN=aresample=async=1:first_pts=0,atempo=!vel!"
if "!SCALE_MODE!"=="0" (
    set "VF_CHAIN=setpts=PTS/!vel!"
) else if defined SRC_H (
    set "VF_CHAIN=setpts=PTS/!vel!,scale=-2:!H_EFFECTIVE!:flags=bilinear"
) else (
    REM fallback se ffprobe falhar: min(ih,H) no filtro (nunca upscale)
    set "VF_CHAIN=setpts=PTS/!vel!,scale=-2:min(ih\,!H_OUT!):flags=bilinear"
)
if exist "!outFile!" del "!outFile!" >nul 2>&1

if "!SCALE_MODE!"=="0" (
    echo [META] origem !SRC_H!px ^<= alvo !H_OUT!px — sem scale, so !vel!x
) else if defined SRC_H (
    echo [META] origem !SRC_H!px — scale para !H_EFFECTIVE!px, !vel!x continuo
) else (
    echo [META] altura origem desconhecida — scale max !H_OUT!px, !vel!x continuo
)

set "META_ARGS=-metadata vp_shrink=1 -metadata vp_shrink_speed=!vel! -metadata vp_shrink_height=!H_OUT!"

if "!HAS_A!"=="1" (
    "!FFMPEG!" -y -hide_banner -loglevel error -i "!orig!" -filter_complex "[0:v]!VF_CHAIN![v];[0:a]!AF_CHAIN![a]" -map "[v]" -map "[a]" !VENC_ARGS! -c:a aac -b:a 128k !META_ARGS! -movflags +faststart -threads 0 "!outFile!"
) else (
    "!FFMPEG!" -y -hide_banner -loglevel error -i "!orig!" -vf "!VF_CHAIN!" -an !VENC_ARGS! !META_ARGS! -movflags +faststart -threads 0 "!outFile!"
)

if errorlevel 1 (
    echo [ERRO] falha ao encodar: !orig!
    if exist "!outFile!" del "!outFile!" >nul 2>&1
    endlocal
    exit /b 1
)
if not exist "!outFile!" (
    echo [ERRO] saida em falta: !outFile!
    endlocal
    exit /b 1
)
"!FFPROBE!" -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "!outFile!" >nul 2>&1
if errorlevel 1 (
    echo [ERRO] saida invalida: !outFile!
    del "!outFile!" >nul 2>&1
    endlocal
    exit /b 1
)

echo [OK] !outFile!
endlocal

if not "%SKIP_PAUSE%"=="1" pause
exit /b 0

:try_speed_token
echo %~1| findstr /R /C:"^1\.25$" /C:"^1\.5$" /C:"^2\.0$" /C:"^2$" >nul || exit /b 0
call :apply_speed "%~1"
if errorlevel 1 exit /b 1
exit /b 2

:probe_read_first_line
set "%~2="
if not exist "%~1" exit /b 0
for /f "usebackq delims=" %%L in ("%~1") do (
    set "%~2=%%L"
    goto :probe_read_done
)
:probe_read_done
exit /b 0

:probe_tag_speed
set "%~2="
if not defined FFPROBE exit /b 0
set "_pf=%TEMP%\vp-sh_%RANDOM%_%RANDOM%.txt"
"%FFPROBE%" -v error -show_entries format_tags=vp_shrink_speed -of default=noprint_wrappers=1:nokey=1 "%~1" > "%_pf%" 2>nul
call :probe_read_first_line "%_pf%" %2
if exist "%_pf%" del "%_pf%" >nul 2>&1
exit /b 0

:probe_has_audio
set "%~2=0"
if not defined FFPROBE exit /b 0
set "_pf=%TEMP%\vp-sh_%RANDOM%_%RANDOM%.txt"
"%FFPROBE%" -v error -select_streams a:0 -show_entries stream=index -of csv=p=0 "%~1" > "%_pf%" 2>nul
if exist "%_pf%" for /f "usebackq delims=" %%L in ("%_pf%") do set "%~2=1"
if exist "%_pf%" del "%_pf%" >nul 2>&1
exit /b 0

:probe_video_height
set "%~2="
if not defined FFPROBE exit /b 0
set "_pf=%TEMP%\vp-sh_%RANDOM%_%RANDOM%.txt"
"%FFPROBE%" -v error -select_streams v:0 -show_entries stream=height -of csv=p=0 "%~1" > "%_pf%" 2>nul
call :probe_read_first_line "%_pf%" %2
if exist "%_pf%" del "%_pf%" >nul 2>&1
exit /b 0

:apply_speed
set "SPD=%~1"
if /I "%SPD%"=="2" set "SPD=2.0"
if /I "%SPD%"=="1.25" (
    set "vel=1.25"
    exit /b 0
)
if /I "%SPD%"=="1.5" (
    set "vel=1.5"
    exit /b 0
)
if /I "%SPD%"=="2.0" (
    set "vel=2.0"
    exit /b 0
)
echo [ERRO] Velocidade invalida: %~1  ^(use 1.25, 1.5 ou 2^)
exit /b 1

:missing_video
echo [ERRO] Indique o video a encolher.
echo        Exemplo: shrink_video.bat --speed=1.5 "filme.mkv" 480
echo        Ver: shrink_video.bat --help
exit /b 1

:show_help
echo.
echo shrink_video.bat — um video completo acelerado, sem cortes
echo.
echo Correr na pasta da biblioteca ^(videos na raiz^), apontando para o .bat do repo:
echo   G:\User\Projetos\video_player\scripts\shrink_video.bat "filme.mkv" [opcoes]
echo.
echo   shrink_video.bat "filme.mkv"
echo   shrink_video.bat "filme.mkv" 480
echo   shrink_video.bat 480 1.5 "filme.mkv"
echo   shrink_video.bat --height=720 --speed=1.25 "filme.mkv"
echo   shrink_video.bat --speed=2 "filme.mkv"
echo   shrink_video.bat --force "filme.mkv"
echo.
echo Velocidade: 1.25, 1.5 ou 2 ^(predefinido 1.5^). Flag --speed= ou valor decimal posicional.
echo Saida: shrinked\^<nome^>.mp4  ^(altura predefinida 540 px^)
echo Marca vp_shrink_speed no ficheiro; origem ja marcada ou em shrinked\ e ignorada ^(--force repete^).
echo Se o destino ja existir, nao sobrescreve ^(use --force^).
echo.
echo Se copiou shrink_video.bat para a biblioteca, crie shrink_video.env.bat com VIDEO_PLAYER_ROOT.
echo.
exit /b 0
