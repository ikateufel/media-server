@echo off

setlocal DisableDelayedExpansion
:: Corta trechos marcados (lista de trechos a MANTER) e junta num unico mp4.
:: Entrada via ambiente (Node): VP_EDIT_INPUT, VP_EDIT_CUTS, VP_EDIT_HEIGHT, VP_EDIT_SPEED, VP_EDIT_FORCE
:: Ficheiro VP_EDIT_CUTS: uma linha por trecho "inicio duracao" em segundos (decimal).
:: Saida: edited\<nome>.mp4 na pasta da biblioteca.

set "vel=1.0"
set "H_OUT=1080"
set "OUT_DIR=edited"
set "VIDEO_IN="
set "CUTS_FILE="
set "FORCE=0"
set "SKIP_PAUSE=1"
set "USE_NVENC=auto"
if not defined TRAILER_NVENC_PRESET set "TRAILER_NVENC_PRESET=p4"
if not defined TEMP set "TEMP=C:\Windows\Temp"

set "VP_SCRIPTS_DIR=%~dp0"
if exist "%CD%\edit_video.env.bat" call "%CD%\edit_video.env.bat"
if exist "%~dp0edit_video.env.bat" call "%~dp0edit_video.env.bat"
if not exist "%VP_SCRIPTS_DIR%ffmpeg-on-path.bat" (
    if defined VIDEO_PLAYER_ROOT set "VP_SCRIPTS_DIR=%VIDEO_PLAYER_ROOT%\scripts\"
)
if not exist "%VP_SCRIPTS_DIR%ffmpeg-on-path.bat" goto :ffmpeg_on_path_missing
for %%_ in ("%VP_SCRIPTS_DIR%..") do set "VP_REPO_ROOT=%%~f_"
goto :ffmpeg_on_path_ok

:ffmpeg_on_path_missing
echo [ERRO] ffmpeg-on-path.bat nao encontrado.
exit /b 1

:ffmpeg_on_path_ok

if defined VP_EDIT_HEIGHT set "H_OUT=%VP_EDIT_HEIGHT%"
if defined VP_EDIT_SPEED call :apply_speed "%VP_EDIT_SPEED%"
if /I "%VP_EDIT_FORCE%"=="1" set "FORCE=1"
if defined VP_EDIT_INPUT set "VIDEO_IN=%VP_EDIT_INPUT%"
if defined VP_EDIT_CUTS set "CUTS_FILE=%VP_EDIT_CUTS%"

if not defined VIDEO_IN goto :missing_video
if not defined CUTS_FILE goto :missing_cuts
if not exist "%CUTS_FILE%" goto :cuts_not_found

setlocal EnableDelayedExpansion

if not exist "!VIDEO_IN!" goto :video_not_found_dl
goto :video_found_dl
:video_not_found_dl
echo [ERRO] Video nao encontrado: !VIDEO_IN!
endlocal
exit /b 1
:video_found_dl

if !H_OUT! LSS 144 (
    echo [ERRO] Altura invalida: !H_OUT!
    endlocal
    exit /b 1
)

for %%F in ("!VIDEO_IN!") do (
    set "ORIG=%%~fF"
    set "NOME=%%~nF"
)

set "outFile=!OUT_DIR!\!NOME!.mp4"

echo ====================================================
echo   EDIT-VIDEO v1.0 — remove trechos e junta o resto
echo   Entrada: !ORIG!
echo   Cortes: !CUTS_FILE!
echo   Altura alvo: !H_OUT! px  ^|  Velocidade: !vel!x  ^|  Saida: !outFile!
echo ====================================================

if not exist "!VP_REPO_ROOT!\data" mkdir "!VP_REPO_ROOT!\data" 2>nul
if not exist "!OUT_DIR!" mkdir "!OUT_DIR!" 2>nul

if "!FORCE!"=="0" if exist "!outFile!" goto :skip_already_exists
goto :after_skip_exists
:skip_already_exists
echo [SKIP] Ja existe: !outFile! ^(use --force^)
endlocal
exit /b 0
:after_skip_exists

echo !ORIG!| findstr /I /C:"\edited\" >nul
if not errorlevel 1 goto :skip_in_edited
goto :after_edited_check
:skip_in_edited
echo [SKIP] origem em pasta edited: !ORIG!
endlocal
exit /b 0
:after_edited_check

pushd "!VP_SCRIPTS_DIR!"
call ffmpeg-on-path.bat
set "RC=!errorlevel!"
popd
if !RC! NEQ 0 (
    endlocal
    exit /b !RC!
)

set "VENC_ARGS=-c:v libx264 -preset superfast -tune zerolatency"
if /I "!USE_NVENC!"=="1" goto :pick_nvenc
if /I not "!USE_NVENC!"=="auto" goto :encoder_done
"!FFMPEG!" -hide_banner -loglevel error -f lavfi -i color=c=black:s=256x144:r=1 -frames:v 1 -c:v h264_nvenc -f null NUL >nul 2>&1
if errorlevel 1 (
    echo [INFO] NVENC indisponivel - a usar libx264 ^(CPU^).
    goto :encoder_done
)
:pick_nvenc
set "VENC_ARGS=-c:v h264_nvenc -preset !TRAILER_NVENC_PRESET! -rc vbr -cq 26 -b:v 0"
echo [INFO] Encoder de video: h264_nvenc preset !TRAILER_NVENC_PRESET!.
:encoder_done

set "HAS_A=0"
call :probe_has_audio "!ORIG!" HAS_A

set "SRC_H="
call :probe_video_height "!ORIG!" SRC_H

set "H_EFFECTIVE=!H_OUT!"
set "SCALE_MODE=1"
if defined SRC_H (
    if !SRC_H! LSS !H_OUT! set "H_EFFECTIVE=!SRC_H!"
    if !SRC_H! LEQ !H_OUT! set "SCALE_MODE=0"
)

set "AF_CHAIN=aresample=async=1:first_pts=0"
if not "!vel!"=="1.0" set "AF_CHAIN=!AF_CHAIN!,atempo=!vel!"
if "!SCALE_MODE!"=="0" (
    if "!vel!"=="1.0" (
        set "VF_CHAIN="
    ) else (
        set "VF_CHAIN=setpts=PTS/!vel!"
    )
) else if defined SRC_H (
    if "!vel!"=="1.0" (
        set "VF_CHAIN=scale=-2:!H_EFFECTIVE!:flags=bilinear"
    ) else (
        set "VF_CHAIN=setpts=PTS/!vel!,scale=-2:!H_EFFECTIVE!:flags=bilinear"
    )
) else (
    if "!vel!"=="1.0" (
        set "VF_CHAIN=scale=-2:min(ih\,!H_OUT!):flags=bilinear"
    ) else (
        set "VF_CHAIN=setpts=PTS/!vel!,scale=-2:min(ih\,!H_OUT!):flags=bilinear"
    )
)

if not defined EDIT_TEMP set "EDIT_TEMP=%VP_REPO_ROOT%\data\bat-work\edit"
if not exist "!EDIT_TEMP!" mkdir "!EDIT_TEMP!" 2>nul
if not exist "!EDIT_TEMP!" set "EDIT_TEMP=%TEMP%\vp-edit-%RANDOM%%RANDOM%"

set "tid=!RANDOM!!RANDOM!"
set "LISTA=!EDIT_TEMP!\edit_!tid!.txt"
if exist "!LISTA!" del "!LISTA!" >nul 2>&1

set "SEG_COUNT=0"
set "SEG_IDX=0"

set "USE_COPY=0"
if "!vel!"=="1.0" if "!SCALE_MODE!"=="0" set "USE_COPY=1"

for /f "usebackq tokens=1,2 delims= " %%A in ("!CUTS_FILE!") do (
    if not "%%A"=="" if not "%%B"=="" (
        set /a "SEG_IDX+=1"
        set "st=%%A"
        set "seg_t=%%B"
        set "tmp=!EDIT_TEMP!\e_!SEG_IDX!_!tid!.mp4"
        if "!USE_COPY!"=="1" (
            if "!HAS_A!"=="1" (
                "!FFMPEG!" -y -ss !st! -t !seg_t! -i "!ORIG!" -c copy "!tmp!" >nul 2>&1
            ) else (
                "!FFMPEG!" -y -ss !st! -t !seg_t! -i "!ORIG!" -c copy -an "!tmp!" >nul 2>&1
            )
        ) else if "!HAS_A!"=="1" (
            if "!SCALE_MODE!"=="0" (
                "!FFMPEG!" -y -ss !st! -t !seg_t! -i "!ORIG!" -filter_complex "[0:v]!VF_CHAIN![v];[0:a]!AF_CHAIN![a]" -map "[v]" -map "[a]" !VENC_ARGS! -c:a aac -b:a 128k -threads 0 "!tmp!" >nul 2>&1
            ) else (
                "!FFMPEG!" -y -ss !st! -t !seg_t! -i "!ORIG!" -filter_complex "[0:v]!VF_CHAIN![v];[0:a]!AF_CHAIN![a]" -map "[v]" -map "[a]" !VENC_ARGS! -c:a aac -b:a 128k -threads 0 "!tmp!" >nul 2>&1
            )
        ) else (
            "!FFMPEG!" -y -ss !st! -t !seg_t! -i "!ORIG!" -vf "!VF_CHAIN!" -an !VENC_ARGS! -threads 0 "!tmp!" >nul 2>&1
        )
        if exist "!tmp!" (
            "!FFPROBE!" -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "!tmp!" >nul 2>&1
            if errorlevel 1 (
                echo [AVISO] segmento invalido ignorado: !tmp!
                del "!tmp!" >nul 2>&1
            ) else (
                set "tmpSlash=!tmp:\=/!"
                echo file '!tmpSlash!' >> "!LISTA!"
                set /a "SEG_COUNT+=1"
                echo [META] trecho !SEG_IDX!: !st!s + !seg_t!s
            )
        ) else (
            echo [AVISO] falha ao cortar trecho !st!s + !seg_t!s
        )
    )
)

if !SEG_COUNT! LEQ 0 (
    echo [ERRO] nenhum segmento valido foi gerado.
    del /q "!EDIT_TEMP!\e_*_!tid!.mp4" >nul 2>&1
    if exist "!LISTA!" del "!LISTA!" >nul 2>&1
    endlocal
    exit /b 1
)

if exist "!outFile!" del "!outFile!" >nul 2>&1

echo [UNIR] a juntar !SEG_COUNT! segmento(s)...
set "clog=!EDIT_TEMP!\concat_!tid!.log"
"!FFMPEG!" -y -hide_banner -loglevel error -fflags +genpts -f concat -safe 0 -i "!LISTA!" -c copy "!outFile!" >"!clog!" 2>&1
set "CONCAT_OK=0"
if not errorlevel 1 if exist "!outFile!" (
    "!FFPROBE!" -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "!outFile!" >nul 2>&1
    if not errorlevel 1 set "CONCAT_OK=1"
)
if "!CONCAT_OK!"=="1" (
    del "!clog!" >nul 2>&1
    echo [OK] !outFile! criado.
    goto :cleanup_ok
)

echo [AVISO] -c copy falhou — uniao com re-encoding...
if "!HAS_A!"=="1" (
    "!FFMPEG!" -y -hide_banner -loglevel error -fflags +genpts -f concat -safe 0 -i "!LISTA!" -vf format=yuv420p -c:v libx264 -preset superfast -tune zerolatency -crf 26 -c:a aac -b:a 128k -movflags +faststart "!outFile!" >"!clog!" 2>&1
) else (
    "!FFMPEG!" -y -hide_banner -loglevel error -fflags +genpts -f concat -safe 0 -i "!LISTA!" -vf format=yuv420p -c:v libx264 -preset superfast -tune zerolatency -crf 26 -an -movflags +faststart "!outFile!" >"!clog!" 2>&1
)
set "CONCAT_OK=0"
if not errorlevel 1 if exist "!outFile!" (
    "!FFPROBE!" -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "!outFile!" >nul 2>&1
    if not errorlevel 1 set "CONCAT_OK=1"
)
if "!CONCAT_OK!"=="1" (
    del "!clog!" >nul 2>&1
    echo [OK] !outFile! criado ^(via re-encoding^).
    goto :cleanup_ok
)

echo [ERRO] falha ao unir segmentos.
echo [DET] log: !clog!
del /q "!EDIT_TEMP!\e_*_!tid!.mp4" >nul 2>&1
if exist "!LISTA!" del "!LISTA!" >nul 2>&1
endlocal
exit /b 1

:cleanup_ok
del /q "!EDIT_TEMP!\e_*_!tid!.mp4" >nul 2>&1
if exist "!LISTA!" del "!LISTA!" >nul 2>&1
endlocal
exit /b 0

:probe_read_first_line
set "%~2="
if not exist "%~1" exit /b 0
for /f "usebackq delims=" %%L in ("%~1") do (
    set "%~2=%%L"
    goto :probe_read_done
)
:probe_read_done
exit /b 0

:probe_has_audio
set "%~2=0"
if not defined FFPROBE exit /b 0
set "_pf=%TEMP%\vp-ed_%RANDOM%_%RANDOM%.txt"
"%FFPROBE%" -v error -select_streams a:0 -show_entries stream=index -of csv=p=0 "%~1" > "%_pf%" 2>nul
if exist "%_pf%" for /f "usebackq delims=" %%L in ("%_pf%") do set "%~2=1"
if exist "%_pf%" del "%_pf%" >nul 2>&1
exit /b 0

:probe_video_height
set "%~2="
if not defined FFPROBE exit /b 0
set "_pf=%TEMP%\vp-ed_%RANDOM%_%RANDOM%.txt"
"%FFPROBE%" -v error -select_streams v:0 -show_entries stream=height -of csv=p=0 "%~1" > "%_pf%" 2>nul
call :probe_read_first_line "%_pf%" %2
if exist "%_pf%" del "%_pf%" >nul 2>&1
exit /b 0

:apply_speed
set "SPD=%~1"
if /I "%SPD%"=="2" set "SPD=2.0"
if /I "%SPD%"=="1" set "SPD=1.0"
if /I "%SPD%"=="1.0" (set "vel=1.0" & exit /b 0)
if /I "%SPD%"=="1.25" (set "vel=1.25" & exit /b 0)
if /I "%SPD%"=="1.5" (set "vel=1.5" & exit /b 0)
if /I "%SPD%"=="2.0" (set "vel=2.0" & exit /b 0)
echo [ERRO] Velocidade invalida: %~1  ^(use 1, 1.25, 1.5 ou 2^)
exit /b 1

:missing_video
echo [ERRO] VP_EDIT_INPUT em falta.
exit /b 1

:missing_cuts
echo [ERRO] VP_EDIT_CUTS em falta.
exit /b 1

:cuts_not_found
echo [ERRO] Ficheiro de cortes nao encontrado: %CUTS_FILE%
exit /b 1
