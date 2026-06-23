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
set "H_MIN=720"
set "OUT_DIR=shrinked"
set "VIDEO_IN="
set "FORCE=0"
set "CODEC_MODE=auto"
set "PRIORITIZE_SIZE=0"
set "ENCODER_LABEL="
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
call :resolve_powershell

if /I "%~1"=="--help" goto :show_help
if /I "%~1"=="-h" goto :show_help
if /I "%~1"=="help" goto :show_help
if defined VP_SHRINK_INPUT if "%~1"=="" goto :env_input_mode
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
if /I "%~1"=="--codec" (
    if "%~2"=="" (
        echo [ERRO] --codec requer um valor.
        exit /b 1
    )
    set "CODEC_MODE=%~2"
    shift
    shift
    goto :parse_args
)
echo %~1| findstr /R /C:"^--codec=" >nul && (
    for /f "tokens=2 delims==" %%C in ("%~1") do set "CODEC_MODE=%%C"
    shift
    goto :parse_args
)
if /I "%~1"=="--prioritize-size" (
    set "PRIORITIZE_SIZE=1"
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

:env_input_mode
if defined VP_SHRINK_HEIGHT set "H_OUT=%VP_SHRINK_HEIGHT%"
if defined VP_SHRINK_SPEED call :apply_speed "%VP_SHRINK_SPEED%"
if defined VP_SHRINK_CODEC set "CODEC_MODE=%VP_SHRINK_CODEC%"
if /I "%VP_SHRINK_PRIORITIZE_SIZE%"=="1" set "PRIORITIZE_SIZE=1"
if /I "%VP_SHRINK_FORCE%"=="1" set "FORCE=1"
set "VIDEO_IN=%VP_SHRINK_INPUT%"
goto :args_done

:args_done
if not defined VIDEO_IN goto :missing_video
call :literal_exists "%VIDEO_IN%" _VP_EXISTS
if not "%_VP_EXISTS%"=="1" goto :video_not_found
goto :video_found
:video_not_found
echo [ERRO] Video nao encontrado: %VIDEO_IN%
exit /b 1
:video_found
if %H_OUT% LSS 144 (
    echo [ERRO] Altura invalida: %H_OUT% ^(minimo 144^)
    exit /b 1
)
if %H_OUT% GTR 4320 (
    echo [ERRO] Altura invalida: %H_OUT% ^(maximo 4320^)
    exit /b 1
)

for %%F in ("%VIDEO_IN%") do set "ORIG=%%~fF"
for %%F in ("%VIDEO_IN%") do set "NOME=%%~nF"
set "outFile=%OUT_DIR%\%NOME%.mp4"
for %%F in ("%outFile%") do set "outFile=%%~fF"

echo ====================================================
echo   SHRINK-VIDEO v2.0 — video completo ^(%vel%x, sem cortes^)
echo   Entrada: "%ORIG%"
echo   Altura alvo: %H_OUT% px  ^|  Velocidade: %vel%x  ^|  Codec: %CODEC_MODE%  ^|  Priorizar tamanho: %PRIORITIZE_SIZE%  ^|  Saida: "%outFile%"
echo   setpts=PTS/%vel%, atempo=%vel%
echo ====================================================

if not exist "%VP_REPO_ROOT%\data" mkdir "%VP_REPO_ROOT%\data" 2>nul
if not exist "%OUT_DIR%" mkdir "%OUT_DIR%" 2>nul

if not "%FORCE%"=="0" goto :after_skip_exists
call :literal_exists "%outFile%" _VP_EXISTS
if "%_VP_EXISTS%"=="1" goto :skip_already_exists
goto :after_skip_exists

:skip_already_exists
echo [SKIP] Ja existe: %outFile% ^(use --force para substituir^)
exit /b 0

:after_skip_exists

call :path_has_shrinked "%ORIG%" _VP_IN_SHRINKED
if "%_VP_IN_SHRINKED%"=="1" goto :skip_in_shrinked
goto :after_shrinked_check
:skip_in_shrinked
echo [SKIP] origem em pasta shrinked: "%ORIG%"
exit /b 0
:after_shrinked_check

pushd "%VP_SCRIPTS_DIR%"
call ffmpeg-on-path.bat
set "RC=%errorlevel%"
popd
if %RC% NEQ 0 (
    if not "%SKIP_PAUSE%"=="1" pause
    exit /b %RC%
)

if not "%FORCE%"=="0" goto :after_probe_skip
call :probe_tag_speed "%ORIG%" TAG_SPEED
if not defined TAG_SPEED goto :after_probe_skip
echo [SKIP] ja shrinkado ^(vp_shrink_speed=%TAG_SPEED%^): "%ORIG%"
exit /b 0
:after_probe_skip

set "SRC_VCODEC="
call :probe_video_codec "%ORIG%" SRC_VCODEC
call :probe_source_bitrates "%ORIG%"

call :configure_encoder
if errorlevel 1 (
    if not "%SKIP_PAUSE%"=="1" pause
    exit /b 1
)

echo.
echo [PROCESSANDO] "%ORIG%"
call :append_sync_log "%ORIG%"

set "HAS_A=0"
call :probe_has_audio "%ORIG%" HAS_A

set "SRC_H="
call :probe_video_height "%ORIG%" SRC_H

set "SRC_PROBE="
call :probe_media_summary "%ORIG%" SRC_PROBE
if defined SRC_PROBE echo [META] origem: "%SRC_PROBE%"

set "ORIG_BYTES=0"
for %%F in ("%ORIG%") do set "ORIG_BYTES=%%~zF"

set "H_EFFECTIVE=%H_OUT%"
set "SCALE_MODE=1"
if not defined SRC_H goto :src_h_done
if "%SRC_H%"=="" goto :src_h_done
if %SRC_H% LSS %H_OUT% set "H_EFFECTIVE=%SRC_H%"
if %SRC_H% LEQ %H_OUT% set "SCALE_MODE=0"
if %H_EFFECTIVE% LSS %H_MIN% set "H_EFFECTIVE=%H_MIN%"
if %SRC_H% GEQ %H_MIN% if %H_EFFECTIVE% LSS %H_MIN% set "H_EFFECTIVE=%H_MIN%"
:src_h_done

set "AF_CHAIN=aformat=sample_rates=48000:channel_layouts=stereo,aresample=async=1:first_pts=0,atempo=%vel%"
if "%SCALE_MODE%"=="0" goto :vf_no_scale
if not defined SRC_H goto :vf_unknown_h
if "%SRC_H%"=="" goto :vf_unknown_h
set "VF_CHAIN=setpts=PTS/%vel%,scale=-2:%H_EFFECTIVE%:flags=bilinear"
goto :vf_done
:vf_no_scale
set "VF_CHAIN=setpts=PTS/%vel%"
goto :vf_done
:vf_unknown_h
set "VF_CHAIN=setpts=PTS/%vel%,scale=-2:min(ih\,%H_OUT%):flags=bilinear"
:vf_done
call :literal_del "%outFile%"

if "%SCALE_MODE%"=="0" goto :meta_no_scale
if not defined SRC_H goto :meta_unknown_h
if "%SRC_H%"=="" goto :meta_unknown_h
echo [META] origem %SRC_H%px — scale para %H_EFFECTIVE%px, %vel%x continuo
goto :meta_done
:meta_no_scale
echo [META] origem %SRC_H%px ^<= alvo %H_OUT%px — sem scale, so %vel%x
goto :meta_done
:meta_unknown_h
echo [META] altura origem desconhecida — scale max %H_OUT%px, %vel%x continuo
:meta_done
set "META_ARGS=-metadata vp_shrink=1 -metadata vp_shrink_speed=%vel% -metadata vp_shrink_height=%H_OUT% -metadata vp_shrink_codec=%CODEC_MODE%"
if defined SRC_VCODEC set "META_ARGS=%META_ARGS% -metadata vp_shrink_src_codec=%SRC_VCODEC%"
set "FLOG=%TEMP%\vp-shrink_%RANDOM%_%RANDOM%.log"
set "ENC_OK=0"

if not "%HAS_A%"=="1" goto :encode_no_audio
set "VP_IN=%ORIG%"
set "VP_OUT=%outFile%"
set "VP_FLOG=%FLOG%"
set "VP_VF_CHAIN=%VF_CHAIN%"
set "VP_AF_CHAIN=%AF_CHAIN%"
set "VP_VENC_ARGS=%VENC_ARGS%"
set "VP_META_ARGS=%META_ARGS%"
set "VP_AUDIO_BK=%TARGET_A_K%"
set "VP_ENCODE_MODE=av"
"%VP_POWERSHELL%" -NoProfile -ExecutionPolicy Bypass -File "%VP_SCRIPTS_DIR%vp-shrink-encode.ps1"
if errorlevel 1 goto :encode_no_audio
call :literal_exists "%outFile%" _VP_EXISTS
if "%_VP_EXISTS%"=="1" set "ENC_OK=1"
if "%ENC_OK%"=="1" goto :encode_done

:encode_no_audio
if not "%HAS_A%"=="1" goto :encode_run_video_only
echo [AVISO] encode com audio falhou — a tentar sem audio...
if exist "%FLOG%" type "%FLOG%"
call :literal_del "%outFile%"

:encode_run_video_only
set "VP_IN=%ORIG%"
set "VP_OUT=%outFile%"
set "VP_FLOG=%FLOG%"
set "VP_VF_CHAIN=%VF_CHAIN%"
set "VP_AF_CHAIN=%AF_CHAIN%"
set "VP_VENC_ARGS=%VENC_ARGS%"
set "VP_META_ARGS=%META_ARGS%"
set "VP_AUDIO_BK=%TARGET_A_K%"
set "VP_ENCODE_MODE=v"
"%VP_POWERSHELL%" -NoProfile -ExecutionPolicy Bypass -File "%VP_SCRIPTS_DIR%vp-shrink-encode.ps1"
if errorlevel 1 goto :encode_failed
call :literal_exists "%outFile%" _VP_EXISTS
if not "%_VP_EXISTS%"=="1" goto :encode_failed
set "ENC_OK=1"
goto :encode_done

:encode_failed
echo [ERRO] falha ao encodar: "%ORIG%"
if not exist "%FLOG%" goto :encode_failed_cleanup
echo [DET] ffmpeg:
type "%FLOG%"

:encode_failed_cleanup
call :literal_del "%outFile%"
if exist "%FLOG%" del "%FLOG%" >nul 2>&1
exit /b 1

:encode_done

call :literal_exists "%outFile%" _VP_EXISTS
if not "%_VP_EXISTS%"=="1" goto :output_missing
goto :output_validate

:output_missing
echo [ERRO] saida em falta: "%outFile%"
if exist "%FLOG%" type "%FLOG%"
if exist "%FLOG%" del "%FLOG%" >nul 2>&1
exit /b 1

:output_validate
"%FFPROBE%" -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "%outFile%" >nul 2>&1
if errorlevel 1 goto :output_invalid
goto :output_ok

:output_invalid
echo [ERRO] saida invalida: "%outFile%"
call :literal_del "%outFile%"
if exist "%FLOG%" type "%FLOG%"
if exist "%FLOG%" del "%FLOG%" >nul 2>&1
exit /b 1

:output_ok

if exist "%FLOG%" del "%FLOG%" >nul 2>&1

set "OUT_BYTES=0"
for %%F in ("%outFile%") do set "OUT_BYTES=%%~zF"
if %OUT_BYTES% GTR %ORIG_BYTES% if "%PRIORITIZE_SIZE%"=="1" goto :optimize_for_size
if %OUT_BYTES% GTR %ORIG_BYTES% call :log_if_oversized "%ORIG%" "%outFile%" %ORIG_BYTES% %OUT_BYTES% shrink
set "OUT_BYTES=0"
for %%F in ("%outFile%") do set "OUT_BYTES=%%~zF"
goto :output_ok_finish

:optimize_for_size
echo [RETRY] saida maior que origem — a optimizar bitrate (min %H_MIN%px)...
set "VP_SHRINK_ORIG_BYTES=%ORIG_BYTES%"
set "VP_SHRINK_SRC_H=%SRC_H%"
set "VP_SHRINK_H_OUT=%H_OUT%"
set "VP_SHRINK_H_MIN=%H_MIN%"
set "VP_SHRINK_VEL=%vel%"
set "VP_SRC_VCODEC=%SRC_VCODEC%"
set "VP_SRC_V_BPS=%SRC_V_BPS%"
set "VP_ENCODER_KIND=%ENCODER_KIND%"
set "VP_IN=%ORIG%"
set "VP_OUT=%outFile%"
set "_retry_log=%TEMP%\vp-sh-retry_%RANDOM%_%RANDOM%.txt"
"%VP_POWERSHELL%" -NoProfile -ExecutionPolicy Bypass -File "%VP_SCRIPTS_DIR%vp-shrink-size-optimize.ps1" > "%_retry_log%" 2>&1
if exist "%_retry_log%" type "%_retry_log%"
if exist "%_retry_log%" del "%_retry_log%" >nul 2>&1
set "OUT_BYTES=0"
for %%F in ("%outFile%") do set "OUT_BYTES=%%~zF"
if %OUT_BYTES% GTR %ORIG_BYTES% call :log_if_oversized "%ORIG%" "%outFile%" %ORIG_BYTES% %OUT_BYTES% shrink

:output_ok_finish
set "OUT_BYTES=0"
for %%F in ("%outFile%") do set "OUT_BYTES=%%~zF"
set "SIZE_NOTE="
call :format_size_delta "%ORIG_BYTES%" "%OUT_BYTES%" SIZE_NOTE
set "OUT_PROBE="
call :probe_media_summary "%outFile%" OUT_PROBE

if defined OUT_PROBE (
    if defined SIZE_NOTE (
        echo [OK] "%outFile%" — "%OUT_PROBE%" — %SIZE_NOTE%
    ) else (
        echo [OK] "%outFile%" — "%OUT_PROBE%"
    )
) else (
    echo [OK] "%outFile%"
)
if not "%SKIP_PAUSE%"=="1" pause
exit /b 0

:configure_encoder
call :normalize_codec_mode
if errorlevel 1 exit /b 1
if /I "%CODEC_MODE%"=="libx264" goto :enc_libx264
if /I "%CODEC_MODE%"=="h264_nvenc" goto :enc_h264_nvenc
if /I "%CODEC_MODE%"=="hevc_nvenc" goto :enc_hevc_nvenc
if /I "%CODEC_MODE%"=="libx265" goto :enc_libx265
goto :enc_auto

:enc_auto
if not defined SRC_VCODEC (
    echo [AVISO] codec origem desconhecido — destino H.264.
    goto :enc_auto_h264
)
call :map_source_codec_family "%SRC_VCODEC%" AUTO_FAMILY
if /I "%AUTO_FAMILY%"=="hevc" goto :enc_auto_hevc
if /I "%AUTO_FAMILY%"=="h264" goto :enc_auto_h264
echo [AVISO] codec origem «%SRC_VCODEC%» — destino H.264 ^(familia nao mapeada^).
goto :enc_auto_h264

:enc_auto_hevc
echo [META] auto: origem %SRC_VCODEC% — destino HEVC
call :probe_nvenc_hevc
if errorlevel 1 goto :enc_libx265
goto :enc_hevc_nvenc

:enc_auto_h264
if defined SRC_VCODEC echo [META] auto: origem %SRC_VCODEC% — destino H.264 (mesma familia)
set "ENCODER_KIND=h264_nvenc"
set "VENC_ARGS=-c:v libx264 -preset superfast -tune zerolatency -crf 26"
set "ENCODER_LABEL=libx264 CRF26 (CPU)"
if /I "%USE_NVENC%"=="0" goto :enc_done
if /I not "%USE_NVENC%"=="auto" goto :enc_done
call :probe_nvenc_h264
if errorlevel 1 goto :enc_done
set "ENCODER_KIND=h264_nvenc"
set "VENC_ARGS=-c:v h264_nvenc -preset %TRAILER_NVENC_PRESET% -rc vbr -cq 26 -b:v 0"
set "ENCODER_LABEL=h264_nvenc preset %TRAILER_NVENC_PRESET% CQ26"
goto :enc_done

:enc_h264_nvenc
call :probe_nvenc_h264
if errorlevel 1 (
    echo [ERRO] h264_nvenc indisponivel neste sistema.
    exit /b 1
)
set "ENCODER_KIND=h264_nvenc"
set "VENC_ARGS=-c:v h264_nvenc -preset %TRAILER_NVENC_PRESET% -rc vbr -cq 26 -b:v 0"
set "ENCODER_LABEL=h264_nvenc preset %TRAILER_NVENC_PRESET% CQ26"
goto :enc_done

:enc_hevc_nvenc
call :probe_nvenc_hevc
if errorlevel 1 (
    echo [ERRO] hevc_nvenc indisponivel neste sistema.
    exit /b 1
)
set "ENCODER_KIND=hevc_nvenc"
set "VENC_ARGS=-c:v hevc_nvenc -preset %TRAILER_NVENC_PRESET% -rc vbr -cq 28 -b:v 0 -tag:v hvc1"
set "ENCODER_LABEL=hevc_nvenc preset %TRAILER_NVENC_PRESET% CQ28"
goto :enc_done

:enc_libx264
set "ENCODER_KIND=libx264"
set "VENC_ARGS=-c:v libx264 -preset superfast -tune zerolatency -crf 26"
set "ENCODER_LABEL=libx264 CRF26 (CPU)"
goto :enc_done

:enc_libx265
set "ENCODER_KIND=libx265"
set "VENC_ARGS=-c:v libx265 -preset fast -crf 28 -tag:v hvc1"
set "ENCODER_LABEL=libx265 CRF28 (CPU)"
goto :enc_done

:enc_done
call :apply_bitrate_target
echo [INFO] Encoder de video: %ENCODER_LABEL%.
exit /b 0

:normalize_codec_mode
if /I "%CODEC_MODE%"=="auto" exit /b 0
if /I "%CODEC_MODE%"=="h264_nvenc" exit /b 0
if /I "%CODEC_MODE%"=="libx264" exit /b 0
if /I "%CODEC_MODE%"=="hevc_nvenc" exit /b 0
if /I "%CODEC_MODE%"=="libx265" exit /b 0
echo [ERRO] Codec invalido: %CODEC_MODE%  ^(use auto, h264_nvenc, libx264, hevc_nvenc, libx265^)
exit /b 1

:probe_nvenc_h264
"%FFMPEG%" -hide_banner -loglevel error -f lavfi -i color=c=black:s=256x144:r=1 -frames:v 1 -c:v h264_nvenc -f null NUL >nul 2>&1
exit /b %errorlevel%

:probe_nvenc_hevc
"%FFMPEG%" -hide_banner -loglevel error -f lavfi -i color=c=black:s=256x144:r=1 -frames:v 1 -c:v hevc_nvenc -f null NUL >nul 2>&1
exit /b %errorlevel%

:map_source_codec_family
set "%~2=h264"
if "%~1"=="" exit /b 0
echo %~1| findstr /I /R "^hevc$ ^h265$" >nul
if not errorlevel 1 (
    set "%~2=hevc"
    exit /b 0
)
echo %~1| findstr /I /R "^h264$ ^avc" >nul
if not errorlevel 1 (
    set "%~2=h264"
    exit /b 0
)
set "%~2=other"
exit /b 0

:probe_video_codec
set "%~2="
if not defined FFPROBE exit /b 0
set "_pf=%TEMP%\vp-sh_%RANDOM%_%RANDOM%.txt"
"%FFPROBE%" -v error -select_streams v:0 -show_entries stream=codec_name -of default=noprint_wrappers=1:nokey=1 "%~1" > "%_pf%" 2>nul
call :probe_read_first_line "%_pf%" %2
if exist "%_pf%" del "%_pf%" >nul 2>&1
exit /b 0

:try_speed_token
echo %~1| findstr /R /C:"^1\.25$" /C:"^1\.5$" /C:"^2\.0$" /C:"^2$" >nul || exit /b 0
call :apply_speed "%~1"
if errorlevel 1 exit /b 1
exit /b 2

:append_sync_log
if "%~1"=="" exit /b 0
set "VP_LOG_LINE=%~1"
"%VP_POWERSHELL%" -NoProfile -Command "if ($env:VP_REPO_ROOT) { $p = Join-Path $env:VP_REPO_ROOT 'data\sync-bat-processing.log'; $d = Split-Path -Parent -Path $p; if ($d -and -not (Test-Path -LiteralPath $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }; Add-Content -LiteralPath $p -Value $env:VP_LOG_LINE }" >nul 2>&1
set "VP_LOG_LINE="
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

:literal_exists
set "%~2=0"
if "%~1"=="" exit /b 0
set "VP_LITERAL_PATH=%~1"
"%VP_POWERSHELL%" -NoProfile -Command "if (Test-Path -LiteralPath $env:VP_LITERAL_PATH) { exit 0 } else { exit 1 }" >nul 2>&1
if not errorlevel 1 set "%~2=1"
set "VP_LITERAL_PATH="
exit /b 0

:literal_del
if "%~1"=="" exit /b 0
set "VP_LITERAL_PATH=%~1"
"%VP_POWERSHELL%" -NoProfile -Command "Remove-Item -LiteralPath $env:VP_LITERAL_PATH -Force -ErrorAction SilentlyContinue" >nul 2>&1
set "VP_LITERAL_PATH="
exit /b 0

:path_has_shrinked
set "%~2=0"
if "%~1"=="" exit /b 0
set "VP_LITERAL_PATH=%~1"
"%VP_POWERSHELL%" -NoProfile -Command "if ($env:VP_LITERAL_PATH -match '(?i)[\\/]shrinked[\\/]') { exit 0 } else { exit 1 }" >nul 2>&1
if not errorlevel 1 set "%~2=1"
set "VP_LITERAL_PATH="
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

:probe_stream_bitrate
set "%~3="
if not defined FFPROBE exit /b 0
if "%~2"=="" exit /b 0
set "_pf=%TEMP%\vp-sh_%RANDOM%_%RANDOM%.txt"
"%FFPROBE%" -v error -select_streams %~2 -show_entries stream=bit_rate -of default=noprint_wrappers=1:nokey=1 "%~1" > "%_pf%" 2>nul
call :probe_read_first_line "%_pf%" %3
if exist "%_pf%" del "%_pf%" >nul 2>&1
exit /b 0

:probe_format_bitrate
set "%~2="
if not defined FFPROBE exit /b 0
set "_pf=%TEMP%\vp-sh_%RANDOM%_%RANDOM%.txt"
"%FFPROBE%" -v error -show_entries format=bit_rate -of default=noprint_wrappers=1:nokey=1 "%~1" > "%_pf%" 2>nul
call :probe_read_first_line "%_pf%" %2
if exist "%_pf%" del "%_pf%" >nul 2>&1
exit /b 0

:probe_source_bitrates
set "SRC_V_BPS="
set "SRC_A_BPS="
call :probe_stream_bitrate "%ORIG%" v:0 SRC_V_BPS
call :probe_stream_bitrate "%ORIG%" a:0 SRC_A_BPS
if defined SRC_V_BPS if %SRC_V_BPS% GTR 0 goto :probe_bitrates_done
set "FMT_BPS="
call :probe_format_bitrate "%ORIG%" FMT_BPS
if not defined FMT_BPS goto :probe_bitrates_done
if %FMT_BPS% LEQ 0 goto :probe_bitrates_done
set /a SRC_V_BPS=FMT_BPS * 85 / 100
if defined SRC_A_BPS if %SRC_A_BPS% GTR 0 goto :probe_bitrates_done
set /a SRC_A_BPS=FMT_BPS * 12 / 100
:probe_bitrates_done
exit /b 0

:apply_bitrate_target
if not defined SRC_V_BPS goto :bitrate_done
if %SRC_V_BPS% LEQ 0 goto :bitrate_done
if not defined ENCODER_KIND goto :bitrate_done
call :velo_div_for_bitrate
set /a SRC_V_KBPS=SRC_V_BPS / 1000
set /a TARGET_V_K=SRC_V_KBPS * 92 / VELO_DIV
if %TARGET_V_K% LSS 400 set "TARGET_V_K=400"
set /a TARGET_V_MAX=TARGET_V_K * 115 / 100
set /a TARGET_V_BUF=TARGET_V_K * 2
echo [META] bitrate video alvo: %TARGET_V_K% kbps (origem ~%SRC_V_KBPS% kbps, %vel%x mais rapido)
set "TARGET_A_K=96"
if not defined SRC_A_BPS goto :audio_k_done
if %SRC_A_BPS% LEQ 0 goto :audio_k_done
set /a SRC_A_KBPS=SRC_A_BPS / 1000
set /a TARGET_A_K=SRC_A_KBPS * 95 / VELO_DIV
if %TARGET_A_K% LSS 64 set /a TARGET_A_K=64
if %TARGET_A_K% GTR 128 set /a TARGET_A_K=128
:audio_k_done
if /I "%ENCODER_KIND%"=="h264_nvenc" (
    set "VENC_ARGS=-c:v h264_nvenc -preset %TRAILER_NVENC_PRESET% -rc vbr -b:v %TARGET_V_K%k -maxrate %TARGET_V_MAX%k -bufsize %TARGET_V_BUF%k"
    set "ENCODER_LABEL=h264_nvenc VBR %TARGET_V_K%k (origem/%vel%x)"
    goto :bitrate_done
)
if /I "%ENCODER_KIND%"=="libx264" (
    set "VENC_ARGS=-c:v libx264 -preset superfast -tune zerolatency -b:v %TARGET_V_K%k -maxrate %TARGET_V_MAX%k -bufsize %TARGET_V_BUF%k"
    set "ENCODER_LABEL=libx264 VBR %TARGET_V_K%k (origem/%vel%x)"
    goto :bitrate_done
)
if /I "%ENCODER_KIND%"=="hevc_nvenc" (
    set "VENC_ARGS=-c:v hevc_nvenc -preset %TRAILER_NVENC_PRESET% -rc vbr -b:v %TARGET_V_K%k -maxrate %TARGET_V_MAX%k -bufsize %TARGET_V_BUF%k -tag:v hvc1"
    set "ENCODER_LABEL=hevc_nvenc VBR %TARGET_V_K%k (origem/%vel%x)"
    goto :bitrate_done
)
if /I "%ENCODER_KIND%"=="libx265" (
    set "VENC_ARGS=-c:v libx265 -preset fast -b:v %TARGET_V_K%k -maxrate %TARGET_V_MAX%k -bufsize %TARGET_V_BUF%k -tag:v hvc1"
    set "ENCODER_LABEL=libx265 VBR %TARGET_V_K%k (origem/%vel%x)"
    goto :bitrate_done
)
:bitrate_done
exit /b 0

:probe_media_summary
set "%~2="
if not defined FFPROBE exit /b 0
if "%~1"=="" exit /b 0
set "_pf=%TEMP%\vp-sh_%RANDOM%_%RANDOM%.txt"
set "VP_LITERAL_PATH=%~1"
"%VP_POWERSHELL%" -NoProfile -ExecutionPolicy Bypass -File "%VP_SCRIPTS_DIR%vp-probe-media.ps1" > "%_pf%" 2>nul
call :probe_read_first_line "%_pf%" %2
if exist "%_pf%" del "%_pf%" >nul 2>&1
set "VP_LITERAL_PATH="
exit /b 0

:format_size_delta
set "%~3="
if "%~1"=="" exit /b 0
if "%~2"=="" exit /b 0
set "VP_SZ_ORIG=%~1"
set "VP_SZ_OUT=%~2"
set "_pf=%TEMP%\vp-sh_%RANDOM%_%RANDOM%.txt"
"%VP_POWERSHELL%" -NoProfile -Command "$o=[int64]$env:VP_SZ_ORIG; $n=[int64]$env:VP_SZ_OUT; function F($b){if($b -ge 1GB){'{0:N1} GB' -f ($b/1GB)}elseif($b -ge 1MB){'{0:N1} MB' -f ($b/1MB)}else{'{0:N0} KB' -f ($b/1KB)}}; if($o -le 0){'tamanho saida '+$(F $n)} else { $pct=($n-$o)*100.0/$o; $sign=if($pct -ge 0){'+'}else{''}; 'origem {0}, saida {1} ({2}{3:N0}%%)' -f (F $o),(F $n),$sign,$pct }" > "%_pf%" 2>nul
call :probe_read_first_line "%_pf%" %3
if exist "%_pf%" del "%_pf%" >nul 2>&1
set "VP_SZ_ORIG="
set "VP_SZ_OUT="
exit /b 0

:log_if_oversized
set "RV_ORI=%~1"
set "RV_OUT=%~2"
set "RV_OB=%~3"
set "RV_NB=%~4"
set "RV_TOOL=%~5"
echo [OVERSIZED] saida maior que origem ^(%RV_NB% ^> %RV_OB%^) — registado em data\%~5-oversized.log
if not exist "%VP_REPO_ROOT%\data" mkdir "%VP_REPO_ROOT%\data" 2>nul
"%VP_POWERSHELL%" -NoProfile -Command "Add-Content -LiteralPath '%VP_REPO_ROOT%\data\%~5-oversized.log' -Value ((Get-Date -Format o)+'`t%~5`t%~1`t%~2`t%~3`t%~4')" 2>nul
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

:velo_div_for_bitrate
set "VELO_DIV=150"
if /I "%vel%"=="1.25" set "VELO_DIV=125"
if /I "%vel%"=="1.5" set "VELO_DIV=150"
if /I "%vel%"=="2.0" set "VELO_DIV=200"
if /I "%vel%"=="2" set "VELO_DIV=200"
exit /b 0

:resolve_powershell
if defined VP_POWERSHELL if exist "%VP_POWERSHELL%" exit /b 0
set "VP_POWERSHELL="
if defined SystemRoot if exist "%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" (
    set "VP_POWERSHELL=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
    exit /b 0
)
if defined windir if exist "%windir%\System32\WindowsPowerShell\v1.0\powershell.exe" (
    set "VP_POWERSHELL=%windir%\System32\WindowsPowerShell\v1.0\powershell.exe"
    exit /b 0
)
for /f "delims=" %%P in ('where powershell.exe 2^>nul') do (
    set "VP_POWERSHELL=%%P"
    goto :resolve_powershell_done
)
:resolve_powershell_done
if not defined VP_POWERSHELL set "VP_POWERSHELL=powershell.exe"
exit /b 0

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
echo Codec: auto ^(predef.^) usa a familia do original ^(H.264/HEVC^); ou h264_nvenc, libx264, hevc_nvenc, libx265.
echo   --prioritize-size com auto: se saida ^> origem, retry bitrate menor em 720p+.
echo Bitrate alvo: origem / velocidade (1.5x ~ 67%% do tamanho se mesma compressao). Minimo 720p.
echo Reencode + AAC 128k — HEVC costuma gerar ficheiros menores; H.264 e mais compativel.
echo Saida: shrinked\^<nome^>.mp4
echo Marca vp_shrink_speed no ficheiro; origem ja marcada ou em shrinked\ e ignorada ^(--force repete^).
echo Se o destino ja existir, nao sobrescreve ^(use --force^).
echo.
echo Se copiou shrink_video.bat para a biblioteca, crie shrink_video.env.bat com VIDEO_PLAYER_ROOT.
echo.
exit /b 0
