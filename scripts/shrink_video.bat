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
set "USE_NVENC=1"
set "SHRINK_SMALL_BYTES=419430400"
if not defined TRAILER_NVENC_PRESET set "TRAILER_NVENC_PRESET=p4"
if not defined SHRINK_FAST_NVENC_PRESET set "SHRINK_FAST_NVENC_PRESET=p2"
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

set "ORIG_BYTES=0"
for %%F in ("%ORIG%") do set "ORIG_BYTES=%%~zF"
call :cap_speed_for_small_file

echo ====================================================
echo   SHRINK-VIDEO v2.8 — video completo ^(%vel%x, sem cortes^)
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
set "VP_SRC_VCODEC=%SRC_VCODEC%"
set "_codec_msg=%TEMP%\vp-sh_%RANDOM%_%RANDOM%.txt"
"%VP_POWERSHELL%" -NoProfile -ExecutionPolicy Bypass -File "%VP_SCRIPTS_DIR%vp-shrink-assess-codec.ps1" > "%_codec_msg%" 2>nul
if errorlevel 1 goto :skip_unsupported_source_codec
if exist "%_codec_msg%" del "%_codec_msg%" >nul 2>&1
call :probe_source_bitrates "%ORIG%"
set "SRC_H="
call :probe_video_height "%ORIG%" SRC_H

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

if not defined SRC_H call :probe_video_height "%ORIG%" SRC_H

set "SRC_PROBE="
call :probe_media_summary "%ORIG%" SRC_PROBE
if defined SRC_PROBE echo [META] origem: "%SRC_PROBE%"

set "H_EFFECTIVE=%H_OUT%"
set "SCALE_MODE=1"
if not defined SRC_H goto :src_h_done
if "%SRC_H%"=="" goto :src_h_done
if %SRC_H% GTR %H_OUT% (
    set "H_EFFECTIVE=%H_OUT%"
    set "SCALE_MODE=1"
    if %SRC_H% GEQ %H_MIN% if %H_EFFECTIVE% LSS %H_MIN% set "H_EFFECTIVE=%H_MIN%"
) else (
    set "H_EFFECTIVE=%SRC_H%"
    set "SCALE_MODE=0"
)
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
set "META_ARGS=%META_ARGS% -metadata vp_shrink_bitrate_mode=fast"
if not defined TARGET_A_K set "TARGET_A_K=128"
call :apply_fast_encode_bitrate_cap
set "FLOG=%TEMP%\vp-shrink_%RANDOM%_%RANDOM%.log"
set "VP_SHRINK_OUT=%outFile%"
call :invoke_vp_encode
if errorlevel 1 goto :encode_failed
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
if "%PRIORITIZE_SIZE%"=="1" (
    if %OUT_BYTES% GTR %ORIG_BYTES% goto :give_up_oversized
    call :quality_retry_if_needed
    if %OUT_BYTES% GTR %ORIG_BYTES% goto :give_up_oversized
    goto :output_ok_finish
)
set "VP_ORIG_BYTES=%ORIG_BYTES%"
set "VP_OUT_BYTES=%OUT_BYTES%"
"%VP_POWERSHELL%" -NoProfile -ExecutionPolicy Bypass -File "%VP_SCRIPTS_DIR%vp-shrink-size-check.ps1"
set "SIZE_CHECK=%ERRORLEVEL%"
if %SIZE_CHECK% EQU 0 goto :output_ok_finish
if %SIZE_CHECK% EQU 2 (
    echo [ERRO] saida invalida ou esmagada demais — shrinked apagado
    call :literal_del "%outFile%"
    exit /b 1
)
set "_pf=%TEMP%\vp-sh_%RANDOM%_%RANDOM%.txt"
"%VP_POWERSHELL%" -NoProfile -Command "$o=[int64]$env:VP_ORIG_BYTES;$n=[int64]$env:VP_OUT_BYTES;if($o -gt 0){[int][math]::Round($n*100.0/$o)}else{0}" > "%_pf%" 2>nul
set "OUT_PCT=?"
if exist "%_pf%" for /f "usebackq delims=" %%P in ("%_pf%") do set "OUT_PCT=%%P"
if exist "%_pf%" del "%_pf%" >nul 2>&1
set "VP_MP_PHASE=2"
if %OUT_BYTES% GTR %ORIG_BYTES% set "VP_MP_PHASE=3"
for %%F in ("%ORIG%") do set "VP_LIST_REL=%%~nxF"
for %%F in ("%ORIG%") do set "VP_SOURCE_ROOT=%%~dpF"
if "%VP_SOURCE_ROOT:~-1%"=="\" set "VP_SOURCE_ROOT=%VP_SOURCE_ROOT:~0,-1%"
echo [SKIP] reducao insuficiente — saida %OUT_PCT%%% do original ^(precisa ^<=70%%^) — shrinked apagado — lista data\shrink-multipass.txt
if defined VP_SHRINK_FROM_SERVER (
    echo [INSUFFICIENT-LIST] %VP_MP_PHASE%^|%VP_LIST_REL%^|%ORIG_BYTES%^|%OUT_BYTES%^|%OUT_PCT%
) else (
    set "VP_SHRINK_PHASE=%VP_MP_PHASE%"
    set "VP_OUT_PCT=%OUT_PCT%"
    set "VP_REL_NAME=%VP_LIST_REL%"
    "%VP_POWERSHELL%" -NoProfile -ExecutionPolicy Bypass -File "%VP_SCRIPTS_DIR%vp-shrink-log-multipass.ps1"
)
call :literal_del "%outFile%"
exit /b 0

:give_up_oversized
echo [OVERSIZED] saida maior que origem ^(%OUT_BYTES% ^> %ORIG_BYTES%^) — shrinked apagado ^(sem 3a passagem^) — registo em shrink-skipped.txt
call :append_work_dir_log oversized "%ORIG%" "saida %OUT_BYTES% ^> origem %ORIG_BYTES% bytes"
if not defined VP_SHRINK_FROM_SERVER call :log_if_oversized "%ORIG%" "%outFile%" %ORIG_BYTES% %OUT_BYTES% shrink
call :literal_del "%outFile%"
exit /b 0

:optimize_for_size
echo [PHASE3] 3a passagem priorizar tamanho — saida maior que origem
if not defined VP_SHRINK_FROM_SERVER call :log_if_phase_run 3 "%ORIG%"
if not defined VP_SHRINK_FROM_SERVER echo [PHASE3-LIST] registado em data\shrink-phase3-run-*.txt
echo [RETRY] saida maior que origem — 3a passagem com bitrate menor (min %H_MIN%px)...
set "VP_SHRINK_ORIG_BYTES=%ORIG_BYTES%"
set "VP_SHRINK_SRC_H=%SRC_H%"
set "VP_SHRINK_H_OUT=%H_OUT%"
set "VP_SHRINK_H_MIN=%H_MIN%"
set "VP_SHRINK_VEL=%vel%"
set "VP_SRC_VCODEC=%SRC_VCODEC%"
set "VP_SRC_V_BPS=%SRC_V_BPS%"
set "VP_ENCODER_KIND=%ENCODER_KIND%"
set "VP_SHRINK_PRIORITIZE_SIZE=%PRIORITIZE_SIZE%"
set "VP_IN=%ORIG%"
set "VP_OUT=%outFile%"
set "_retry_log=%TEMP%\vp-sh-retry_%RANDOM%_%RANDOM%.txt"
"%VP_POWERSHELL%" -NoProfile -ExecutionPolicy Bypass -File "%VP_SCRIPTS_DIR%vp-shrink-size-optimize.ps1" > "%_retry_log%" 2>&1
if exist "%_retry_log%" type "%_retry_log%"
if exist "%_retry_log%" del "%_retry_log%" >nul 2>&1
set "OUT_BYTES=0"
for %%F in ("%outFile%") do set "OUT_BYTES=%%~zF"
echo [RETRY-LIST] registado em data\shrink-retry-*.txt
if not defined VP_SHRINK_FROM_SERVER call :log_if_retry "%ORIG%" "%outFile%" %ORIG_BYTES% %OUT_BYTES%
if %OUT_BYTES% GTR %ORIG_BYTES% (
    echo [OVERSIZED] saida maior que origem ^(%OUT_BYTES% ^> %ORIG_BYTES%^) — shrinked apagado
    if not defined VP_SHRINK_FROM_SERVER call :log_if_oversized "%ORIG%" "%outFile%" %ORIG_BYTES% %OUT_BYTES% shrink
    call :literal_del "%outFile%"
    echo [SKIP] 3a passagem — saida ainda maior que origem — use lista multipass sem Priorizar tamanho primeiro
    exit /b 0
)

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

:skip_unsupported_source_codec
set "SHRINK_CODEC_SKIP_MSG=codec origem nao adequado para shrink"
if exist "%_codec_msg%" for /f "usebackq delims=" %%M in ("%_codec_msg%") do set "SHRINK_CODEC_SKIP_MSG=%%M"
if exist "%_codec_msg%" del "%_codec_msg%" >nul 2>&1
echo [SKIP] %SHRINK_CODEC_SKIP_MSG%
set "SHRINK_CODEC_SKIP_MSG="
set "_codec_msg="
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
echo [META] auto: origem %SRC_VCODEC% — destino HEVC ^(GPU^)
call :probe_nvenc_hevc
if not errorlevel 1 goto :enc_hevc_nvenc
echo [AVISO] hevc_nvenc indisponivel — a tentar h264_nvenc ^(GPU^)...
call :probe_nvenc_h264
if not errorlevel 1 goto :enc_h264_nvenc
echo [ERRO] NVENC indisponivel — GPU NVIDIA + FFmpeg com nvenc necessarios.
echo        Teste: ffmpeg -encoders ^| findstr nvenc
exit /b 1

:enc_auto_h264
if defined SRC_VCODEC echo [META] auto: origem %SRC_VCODEC% — destino H.264 ^(GPU^)
call :probe_nvenc_h264
if not errorlevel 1 goto :enc_h264_nvenc
echo [AVISO] h264_nvenc indisponivel — a tentar hevc_nvenc ^(GPU^)...
call :probe_nvenc_hevc
if not errorlevel 1 goto :enc_hevc_nvenc
echo [ERRO] NVENC indisponivel — GPU NVIDIA + FFmpeg com nvenc necessarios.
echo        Teste: ffmpeg -encoders ^| findstr nvenc
exit /b 1

:enc_h264_nvenc
call :probe_nvenc_h264
if errorlevel 1 (
    echo [ERRO] h264_nvenc indisponivel neste sistema.
    exit /b 1
)
set "ENCODER_KIND=h264_nvenc"
set "VENC_ARGS=-c:v h264_nvenc -preset %SHRINK_FAST_NVENC_PRESET% -rc vbr -cq 30 -b:v 0"
set "ENCODER_LABEL=h264_nvenc preset %SHRINK_FAST_NVENC_PRESET% CQ30"
goto :enc_done

:enc_hevc_nvenc
call :probe_nvenc_hevc
if errorlevel 1 (
    echo [ERRO] hevc_nvenc indisponivel neste sistema.
    exit /b 1
)
set "ENCODER_KIND=hevc_nvenc"
set "VENC_ARGS=-c:v hevc_nvenc -preset %SHRINK_FAST_NVENC_PRESET% -rc vbr -cq 32 -b:v 0 -tag:v hvc1"
set "ENCODER_LABEL=hevc_nvenc preset %SHRINK_FAST_NVENC_PRESET% CQ32"
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
echo %ENCODER_KIND%| findstr /I "nvenc" >nul 2>&1
if not errorlevel 1 set "VP_GPU_DECODE=1"
if defined FFMPEG echo [META] ffmpeg: "%FFMPEG%"
echo [INFO] Encoder de video: %ENCODER_LABEL% ^(1a passagem rapida^).
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

:append_work_dir_log
if "%~2"=="" exit /b 0
set "VP_WORK_LOG=%CD%\shrink-skipped.txt"
set "VP_LOG_REASON=%~1"
set "VP_LOG_PATH=%~2"
set "VP_LOG_DETAIL=%~3"
"%VP_POWERSHELL%" -NoProfile -ExecutionPolicy Bypass -Command "$p=$env:VP_WORK_LOG; $reason=$env:VP_LOG_REASON; $path=$env:VP_LOG_PATH; $detail=$env:VP_LOG_DETAIL; if(-not $path){exit 0}; $d=Split-Path -Parent $p; if($d -and -not (Test-Path -LiteralPath $d)){New-Item -ItemType Directory -Path $d -Force|Out-Null}; if(-not (Test-Path -LiteralPath $p)){Set-Content -LiteralPath $p -Value @('# shrink — velocidade limitada (^<400 MB) ou saida maior que origem','# data`t razao`t ficheiro`t detalhe','')}; $line=(Get-Date -Format o)+[char]9+$reason+[char]9+$path; if($detail){$line+=[char]9+$detail}; Add-Content -LiteralPath $p -Value $line" 2>nul
set "VP_WORK_LOG="
set "VP_LOG_REASON="
set "VP_LOG_PATH="
set "VP_LOG_DETAIL="
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

:probe_format_duration
set "%~2="
if not defined FFPROBE exit /b 0
set "_pf=%TEMP%\vp-sh_%RANDOM%_%RANDOM%.txt"
"%FFPROBE%" -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "%~1" > "%_pf%" 2>nul
for /f "usebackq tokens=1 delims=." %%D in ("%_pf%") do set "%~2=%%D"
if exist "%_pf%" del "%_pf%" >nul 2>&1
exit /b 0

:probe_source_bitrates
set "SRC_V_BPS="
set "SRC_A_BPS="
if not defined FFPROBE exit /b 0
if not defined ORIG exit /b 0
set "VP_LITERAL_PATH=%ORIG%"
set "_pf=%TEMP%\vp-sh_%RANDOM%_%RANDOM%.txt"
"%VP_POWERSHELL%" -NoProfile -ExecutionPolicy Bypass -File "%VP_SCRIPTS_DIR%vp-shrink-probe-bitrates.ps1" > "%_pf%" 2>nul
if exist "%_pf%" for /f "usebackq tokens=1,* delims==" %%A in ("%_pf%") do (
    if /I "%%A"=="SRC_V_BPS" set "SRC_V_BPS=%%B"
    if /I "%%A"=="SRC_A_BPS" set "SRC_A_BPS=%%B"
)
if exist "%_pf%" del "%_pf%" >nul 2>&1
set "VP_LITERAL_PATH="
if defined SRC_V_BPS if %SRC_V_BPS% GTR 0 (
    set /a SRC_V_K_EST=SRC_V_BPS / 1000
    echo [META] bitrate origem: video ~%SRC_V_K_EST% kbps
)
exit /b 0

:apply_bitrate_target
if not defined SRC_V_BPS goto :bitrate_skip
if %SRC_V_BPS% LEQ 0 goto :bitrate_skip
if not defined ENCODER_KIND goto :bitrate_skip
call :apply_quality_encode_args
goto :bitrate_done

:apply_quality_encode_args
set "TARGET_V_K="
set /a SRC_V_KBPS=SRC_V_BPS / 1000
if %SRC_V_KBPS% LSS 500 (
    echo [AVISO] bitrate origem invalido ^(%SRC_V_KBPS% kbps^) — cancela 2a passagem qualidade
    goto :bitrate_skip
)
set /a TARGET_V_K=SRC_V_KBPS * 98 / 100
if %TARGET_V_K% LSS 800 set /a TARGET_V_K=SRC_V_KBPS * 85 / 100
if %TARGET_V_K% LSS 800 set "TARGET_V_K=800"
set /a TARGET_V_MAX=SRC_V_KBPS * 102 / 100
if %TARGET_V_MAX% LSS %TARGET_V_K% set "TARGET_V_MAX=%TARGET_V_K%"
if %TARGET_V_MAX% LSS 800 set "TARGET_V_MAX=800"
set /a TARGET_V_BUF=TARGET_V_MAX * 2
set "BITRATE_MODE_LABEL=bitrate ~origem"
echo [META] encode qualidade: alvo ~%TARGET_V_K% kbps, max %TARGET_V_MAX% kbps (origem ~%SRC_V_KBPS% kbps)
echo [META] tamanho esperado ~ duracao/%vel%x com mesmo bitrate ^(1.5x ~ 67%% do original^)
set "TARGET_A_K=96"
if not defined SRC_A_BPS goto :quality_audio_done
if %SRC_A_BPS% LEQ 0 goto :quality_audio_done
set /a SRC_A_KBPS=SRC_A_BPS / 1000
set /a TARGET_A_K=SRC_A_KBPS * 98 / 100
if %TARGET_A_K% LSS 64 set /a TARGET_A_K=64
if %TARGET_A_K% GTR 192 set /a TARGET_A_K=192
:quality_audio_done
if /I "%ENCODER_KIND%"=="h264_nvenc" (
    set "VENC_ARGS=-c:v h264_nvenc -preset %TRAILER_NVENC_PRESET% -rc vbr -cq 23 -b:v %TARGET_V_K%k -maxrate %TARGET_V_MAX%k -bufsize %TARGET_V_BUF%k -profile:v high"
    set "ENCODER_LABEL=h264_nvenc ~%TARGET_V_K%k max %TARGET_V_MAX%k (%BITRATE_MODE_LABEL%)"
    goto :bitrate_done
)
if /I "%ENCODER_KIND%"=="libx264" (
    set "VENC_ARGS=-c:v libx264 -preset medium -b:v %TARGET_V_K%k -maxrate %TARGET_V_MAX%k -bufsize %TARGET_V_BUF%k -profile:v high"
    set "ENCODER_LABEL=libx264 ~%TARGET_V_K%k max %TARGET_V_MAX%k (%BITRATE_MODE_LABEL%)"
    goto :bitrate_done
)
if /I "%ENCODER_KIND%"=="hevc_nvenc" (
    set "VENC_ARGS=-c:v hevc_nvenc -preset %TRAILER_NVENC_PRESET% -rc vbr -cq 25 -b:v %TARGET_V_K%k -maxrate %TARGET_V_MAX%k -bufsize %TARGET_V_BUF%k -tag:v hvc1"
    set "ENCODER_LABEL=hevc_nvenc ~%TARGET_V_K%k max %TARGET_V_MAX%k (%BITRATE_MODE_LABEL%)"
    goto :bitrate_done
)
if /I "%ENCODER_KIND%"=="libx265" (
    set "VENC_ARGS=-c:v libx265 -preset medium -b:v %TARGET_V_K%k -maxrate %TARGET_V_MAX%k -bufsize %TARGET_V_BUF%k -tag:v hvc1"
    set "ENCODER_LABEL=libx265 ~%TARGET_V_K%k max %TARGET_V_MAX%k (%BITRATE_MODE_LABEL%)"
    goto :bitrate_done
)
:bitrate_skip
echo [AVISO] bitrate origem desconhecido — encoder CQ/CRF (sem alvo VBR)
set "TARGET_V_K="
:bitrate_done
exit /b 0

:apply_fast_encode_bitrate_cap
if not defined SRC_V_BPS exit /b 0
if %SRC_V_BPS% LEQ 0 exit /b 0
if not defined ENCODER_KIND exit /b 0
set /a SRC_V_KBPS=SRC_V_BPS / 1000
if %SRC_V_KBPS% LSS 200 exit /b 0
set /a TARGET_V_K=SRC_V_KBPS * 75 / 100
if %TARGET_V_K% LSS 400 set "TARGET_V_K=400"
set /a TARGET_V_MAX=SRC_V_KBPS * 88 / 100
if %TARGET_V_MAX% LSS %TARGET_V_K% set "TARGET_V_MAX=%TARGET_V_K%"
set /a TARGET_V_BUF=TARGET_V_MAX * 2
call :apply_hevc_bitrate_discount
if defined SRC_A_BPS if %SRC_A_BPS% GTR 0 (
    set /a TARGET_A_K=SRC_A_BPS / 1000 * 85 / 100
) else (
    set "TARGET_A_K=96"
)
if %TARGET_A_K% LSS 64 set "TARGET_A_K=64"
if %TARGET_A_K% GTR 128 set "TARGET_A_K=128"
echo [META] 1a passagem: cap bitrate ~%TARGET_V_K% kbps ^(max %TARGET_V_MAX% kbps, origem ~%SRC_V_KBPS% kbps^)
if /I "%ENCODER_KIND%"=="h264_nvenc" (
    set "VENC_ARGS=-c:v h264_nvenc -preset %SHRINK_FAST_NVENC_PRESET% -rc vbr -cq 30 -b:v %TARGET_V_K%k -maxrate %TARGET_V_MAX%k -bufsize %TARGET_V_BUF%k -profile:v high"
    set "ENCODER_LABEL=h264_nvenc ~%TARGET_V_K%k max %TARGET_V_MAX%k (cap origem)"
    set "META_ARGS=%META_ARGS% -metadata vp_shrink_target_v_kbps=%TARGET_V_K%"
    goto :fast_cap_done
)
if /I "%ENCODER_KIND%"=="hevc_nvenc" (
    set "VENC_ARGS=-c:v hevc_nvenc -preset %SHRINK_FAST_NVENC_PRESET% -rc vbr -cq 32 -b:v %TARGET_V_K%k -maxrate %TARGET_V_MAX%k -bufsize %TARGET_V_BUF%k -tag:v hvc1"
    set "ENCODER_LABEL=hevc_nvenc ~%TARGET_V_K%k max %TARGET_V_MAX%k (cap origem)"
    set "META_ARGS=%META_ARGS% -metadata vp_shrink_target_v_kbps=%TARGET_V_K%"
    goto :fast_cap_done
)
if /I "%ENCODER_KIND%"=="libx264" (
    set "VENC_ARGS=-c:v libx264 -preset superfast -tune zerolatency -b:v %TARGET_V_K%k -maxrate %TARGET_V_MAX%k -bufsize %TARGET_V_BUF%k -profile:v high"
    set "ENCODER_LABEL=libx264 ~%TARGET_V_K%k max %TARGET_V_MAX%k (cap origem)"
    goto :fast_cap_done
)
if /I "%ENCODER_KIND%"=="libx265" (
    set "VENC_ARGS=-c:v libx265 -preset fast -b:v %TARGET_V_K%k -maxrate %TARGET_V_MAX%k -bufsize %TARGET_V_BUF%k -tag:v hvc1"
    set "ENCODER_LABEL=libx265 ~%TARGET_V_K%k max %TARGET_V_MAX%k (cap origem)"
    goto :fast_cap_done
)
:fast_cap_done
set "META_ARGS=%META_ARGS% -metadata vp_shrink_bitrate_mode=fast-capped"
exit /b 0

:invoke_vp_encode
set "ENC_OK=0"
if not defined VP_SHRINK_OUT exit /b 1
if not "%HAS_A%"=="1" goto :ive_no_audio
set "VP_IN=%ORIG%"
set "VP_OUT=%VP_SHRINK_OUT%"
set "VP_FLOG=%FLOG%"
set "VP_VF_CHAIN=%VF_CHAIN%"
set "VP_AF_CHAIN=%AF_CHAIN%"
set "VP_VENC_ARGS=%VENC_ARGS%"
set "VP_META_ARGS=%META_ARGS%"
set "VP_AUDIO_BK=%TARGET_A_K%"
set "VP_ENCODE_MODE=av"
"%VP_POWERSHELL%" -NoProfile -ExecutionPolicy Bypass -File "%VP_SCRIPTS_DIR%vp-shrink-encode.ps1"
if errorlevel 1 goto :ive_no_audio
call :literal_exists "%VP_SHRINK_OUT%" _VP_EXISTS
if "%_VP_EXISTS%"=="1" set "ENC_OK=1"
if "%ENC_OK%"=="1" exit /b 0

:ive_no_audio
if not "%HAS_A%"=="1" goto :ive_video_only
echo [AVISO] encode com audio falhou — a tentar sem audio...
if exist "%FLOG%" type "%FLOG%"
call :literal_del "%VP_SHRINK_OUT%"

:ive_video_only
set "VP_IN=%ORIG%"
set "VP_OUT=%VP_SHRINK_OUT%"
set "VP_FLOG=%FLOG%"
set "VP_VF_CHAIN=%VF_CHAIN%"
set "VP_AF_CHAIN=%AF_CHAIN%"
set "VP_VENC_ARGS=%VENC_ARGS%"
set "VP_META_ARGS=%META_ARGS%"
set "VP_AUDIO_BK=%TARGET_A_K%"
set "VP_ENCODE_MODE=v"
"%VP_POWERSHELL%" -NoProfile -ExecutionPolicy Bypass -File "%VP_SCRIPTS_DIR%vp-shrink-encode.ps1"
if errorlevel 1 exit /b 1
call :literal_exists "%VP_SHRINK_OUT%" _VP_EXISTS
if not "%_VP_EXISTS%"=="1" exit /b 1
set "ENC_OK=1"
exit /b 0

:quality_retry_if_needed
if not defined ORIG_BYTES exit /b 0
if %ORIG_BYTES% LEQ 0 exit /b 0
set "VP_ORIG_BYTES=%ORIG_BYTES%"
set "VP_OUT_BYTES=%OUT_BYTES%"
"%VP_POWERSHELL%" -NoProfile -ExecutionPolicy Bypass -File "%VP_SCRIPTS_DIR%vp-shrink-size-check.ps1"
set "SIZE_CHECK=%ERRORLEVEL%"
if %SIZE_CHECK% EQU 0 exit /b 0
if %SIZE_CHECK% EQU 2 (
    echo [AVISO] saida 1a passagem invalida ou demasiado pequena — nao faz 2a passagem qualidade
    exit /b 0
)
set "FIRST_OUT_BYTES=%OUT_BYTES%"
set "_pf=%TEMP%\vp-sh_%RANDOM%_%RANDOM%.txt"
"%VP_POWERSHELL%" -NoProfile -Command "$o=[int64]$env:VP_ORIG_BYTES;$n=[int64]$env:VP_OUT_BYTES;if($o -gt 0){[int][math]::Round($n*100.0/$o)}else{0}" > "%_pf%" 2>nul
set "OUT_PCT=?"
if exist "%_pf%" for /f "usebackq delims=" %%P in ("%_pf%") do set "OUT_PCT=%%P"
if exist "%_pf%" del "%_pf%" >nul 2>&1
echo [PHASE2] 2a passagem qualidade — saida %OUT_PCT%%% do original ^(precisa ^<=70%%^)
if not defined VP_SHRINK_FROM_SERVER call :log_if_phase_run 2 "%ORIG%"
if not defined VP_SHRINK_FROM_SERVER echo [PHASE2-LIST] registado em data\shrink-phase2-run-*.txt
echo [RETRY] reducao insuficiente — saida %OUT_PCT%%% do original ^(precisa ^<=70%%^) — 2a passagem qualidade...
call :probe_source_bitrates
call :apply_quality_encode_args
if not defined TARGET_V_K (
    echo [AVISO] bitrate origem desconhecido — mantem 1a passagem rapida
    exit /b 0
)
set "META_ARGS=-metadata vp_shrink=1 -metadata vp_shrink_speed=%vel% -metadata vp_shrink_height=%H_OUT% -metadata vp_shrink_codec=%CODEC_MODE%"
if defined SRC_VCODEC set "META_ARGS=%META_ARGS% -metadata vp_shrink_src_codec=%SRC_VCODEC%"
if defined TARGET_V_K set "META_ARGS=%META_ARGS% -metadata vp_shrink_target_v_kbps=%TARGET_V_K%"
set "META_ARGS=%META_ARGS% -metadata vp_shrink_bitrate_mode=quality-match"
echo [INFO] Encoder 2a passagem: %ENCODER_LABEL%
set "VP_QUALITY_OUT=%outFile%.vp-quality.mp4"
call :literal_del "%VP_QUALITY_OUT%"
set "FLOG=%TEMP%\vp-shrink_%RANDOM%_%RANDOM%.log"
set "VP_SHRINK_OUT=%VP_QUALITY_OUT%"
call :invoke_vp_encode
if errorlevel 1 (
    echo [AVISO] 2a passagem qualidade falhou — mantem 1a passagem
    call :literal_del "%VP_QUALITY_OUT%"
    exit /b 0
)
call :literal_exists "%VP_QUALITY_OUT%" _VP_EXISTS
if not "%_VP_EXISTS%"=="1" exit /b 0
"%FFPROBE%" -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "%VP_QUALITY_OUT%" >nul 2>&1
if errorlevel 1 (
    echo [AVISO] 2a passagem invalida — mantem 1a passagem
    call :literal_del "%VP_QUALITY_OUT%"
    exit /b 0
)
set "QUAL_BYTES=0"
for %%F in ("%VP_QUALITY_OUT%") do set "QUAL_BYTES=%%~zF"
set "VP_OUT_BYTES=%QUAL_BYTES%"
"%VP_POWERSHELL%" -NoProfile -ExecutionPolicy Bypass -File "%VP_SCRIPTS_DIR%vp-shrink-size-check.ps1"
set "QUAL_CHECK=%ERRORLEVEL%"
set "_pf=%TEMP%\vp-sh_%RANDOM%_%RANDOM%.txt"
"%VP_POWERSHELL%" -NoProfile -Command "$o=[int64]$env:VP_ORIG_BYTES;$n=[int64]$env:VP_OUT_BYTES;if($o -gt 0){[int][math]::Round($n*100.0/$o)}else{0}" > "%_pf%" 2>nul
set "QUAL_PCT=?"
if exist "%_pf%" for /f "usebackq delims=" %%P in ("%_pf%") do set "QUAL_PCT=%%P"
if exist "%_pf%" del "%_pf%" >nul 2>&1
if %QUAL_CHECK% EQU 2 (
    echo [AVISO] 2a passagem invalida ou esmagada demais — mantem 1a passagem
    call :literal_del "%VP_QUALITY_OUT%"
    exit /b 0
)
if not %QUAL_CHECK% EQU 0 (
    echo [AVISO] 2a passagem %QUAL_PCT%%% — ainda ^>70%% do original, mantem 1a passagem
    call :literal_del "%VP_QUALITY_OUT%"
    exit /b 0
)
if %QUAL_BYTES% GEQ %FIRST_OUT_BYTES% (
    echo [AVISO] 2a passagem %QUAL_PCT%%% — nao ficou menor que 1a passagem ^(%OUT_PCT%%%^)
    call :literal_del "%VP_QUALITY_OUT%"
    exit /b 0
)
call :literal_del "%outFile%"
move /Y "%VP_QUALITY_OUT%" "%outFile%" >nul
set "OUT_BYTES=%QUAL_BYTES%"
echo [RETRY-OK] 2a passagem qualidade — %QUAL_PCT%%% do original
exit /b 0

:apply_hevc_bitrate_discount
if /I not "%ENCODER_KIND%"=="hevc_nvenc" if /I not "%ENCODER_KIND%"=="libx265" exit /b 0
set "SRC_FAMILY=h264"
if defined SRC_VCODEC call :map_source_codec_family "%SRC_VCODEC%" SRC_FAMILY
if /I "%SRC_FAMILY%"=="hevc" exit /b 0
set /a TARGET_V_K=TARGET_V_K * 85 / 100
if %TARGET_V_K% LSS 400 set "TARGET_V_K=400"
echo [META] HEVC de origem H.264: alvo ~85%% do equivalente H.264 (%TARGET_V_K% kbps)
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

:log_if_phase_run
if not exist "%VP_REPO_ROOT%\data" mkdir "%VP_REPO_ROOT%\data" 2>nul
set "VP_PHASE_NUM=%~1"
set "VP_LIST_ORIG=%~2"
if "%VP_PHASE_NUM%"=="2" (
    set "VP_LIST_PATH=%VP_REPO_ROOT%\data\shrink-phase2-run-paths.txt"
) else (
    set "VP_LIST_PATH=%VP_REPO_ROOT%\data\shrink-phase3-run-paths.txt"
)
"%VP_POWERSHELL%" -NoProfile -ExecutionPolicy Bypass -Command "$p=$env:VP_LIST_PATH; $o=$env:VP_LIST_ORIG; if(-not $o){exit 0}; $d=Split-Path -Parent $p; if($d -and -not (Test-Path $d)){New-Item -ItemType Directory -Path $d -Force|Out-Null}; $exists=$false; if(Test-Path $p){$exists=(Get-Content -LiteralPath $p|Where-Object{$_.Trim() -and -not $_.StartsWith('#')}|ForEach-Object{$_.Trim().ToLowerCase()}) -contains $o.ToLowerCase()}; if(-not $exists){ if(-not (Test-Path $p)){Set-Content -LiteralPath $p -Value @('# shrink fase '+$env:VP_PHASE_NUM+' run — origem','')}; Add-Content -LiteralPath $p -Value $o }" 2>nul
if "%VP_PHASE_NUM%"=="2" (
    set "VP_LIST_PATH=%VP_REPO_ROOT%\data\shrink-phase2-run-rels.txt"
) else (
    set "VP_LIST_PATH=%VP_REPO_ROOT%\data\shrink-phase3-run-rels.txt"
)
for %%F in ("%~2") do set "VP_LIST_REL=%%~nxF"
"%VP_POWERSHELL%" -NoProfile -ExecutionPolicy Bypass -Command "$p=$env:VP_LIST_PATH; $r=$env:VP_LIST_REL; if(-not $r){exit 0}; $d=Split-Path -Parent $p; if($d -and -not (Test-Path $d)){New-Item -ItemType Directory -Path $d -Force|Out-Null}; $exists=$false; if(Test-Path $p){$exists=(Get-Content -LiteralPath $p|Where-Object{$_.Trim() -and -not $_.StartsWith('#')}|ForEach-Object{$_.Trim().ToLowerCase()}) -contains $r.ToLowerCase()}; if(-not $exists){ if(-not (Test-Path $p)){Set-Content -LiteralPath $p -Value @('# shrink fase '+$env:VP_PHASE_NUM+' run — fila','')}; Add-Content -LiteralPath $p -Value $r }" 2>nul
if "%VP_PHASE_NUM%"=="2" (
    "%VP_POWERSHELL%" -NoProfile -Command "Add-Content -LiteralPath '%VP_REPO_ROOT%\data\shrink-phase2-run.log' -Value ((Get-Date -Format o)+'`t2`t%~2')" 2>nul
) else (
    "%VP_POWERSHELL%" -NoProfile -Command "Add-Content -LiteralPath '%VP_REPO_ROOT%\data\shrink-phase3-run.log' -Value ((Get-Date -Format o)+'`t3`t%~2')" 2>nul
)
set "VP_PHASE_NUM="
set "VP_LIST_PATH="
set "VP_LIST_ORIG="
set "VP_LIST_REL="
exit /b 0

:log_if_retry
if not exist "%VP_REPO_ROOT%\data" mkdir "%VP_REPO_ROOT%\data" 2>nul
"%VP_POWERSHELL%" -NoProfile -Command "Add-Content -LiteralPath '%VP_REPO_ROOT%\data\shrink-retry.log' -Value ((Get-Date -Format o)+'`t%~1`t%~2`t%~3`t%~4')" 2>nul
set "VP_LIST_PATH=%VP_REPO_ROOT%\data\shrink-retry-paths.txt"
set "VP_LIST_ORIG=%~1"
"%VP_POWERSHELL%" -NoProfile -ExecutionPolicy Bypass -Command "$p=$env:VP_LIST_PATH; $o=$env:VP_LIST_ORIG; if(-not $o){exit 0}; $d=Split-Path -Parent $p; if($d -and -not (Test-Path $d)){New-Item -ItemType Directory -Path $d -Force|Out-Null}; $exists=$false; if(Test-Path $p){$exists=(Get-Content -LiteralPath $p|Where-Object{$_.Trim() -and -not $_.StartsWith('#')}|ForEach-Object{$_.Trim().ToLowerCase()}) -contains $o.ToLowerCase()}; if(-not $exists){ if(-not (Test-Path $p)){Set-Content -LiteralPath $p -Value @('# shrink 2a passagem — origem (um por linha)','')}; Add-Content -LiteralPath $p -Value $o }" 2>nul
set "VP_LIST_PATH="
set "VP_LIST_ORIG="
exit /b 0

:log_if_oversized
set "RV_ORI=%~1"
set "RV_OUT=%~2"
set "RV_OB=%~3"
set "RV_NB=%~4"
set "RV_TOOL=%~5"
echo [OVERSIZED] saida maior que origem ^(%RV_NB% ^> %RV_OB%^) — listas em data\%~5-oversized-*.txt
if not exist "%VP_REPO_ROOT%\data" mkdir "%VP_REPO_ROOT%\data" 2>nul
"%VP_POWERSHELL%" -NoProfile -Command "Add-Content -LiteralPath '%VP_REPO_ROOT%\data\%~5-oversized.log' -Value ((Get-Date -Format o)+'`t%~5`t%~1`t%~2`t%~3`t%~4')" 2>nul
set "VP_LIST_PATH=%VP_REPO_ROOT%\data\%~5-oversized-paths.txt"
set "VP_LIST_ORIG=%~1"
"%VP_POWERSHELL%" -NoProfile -ExecutionPolicy Bypass -Command "$p=$env:VP_LIST_PATH; $o=$env:VP_LIST_ORIG; if(-not $o){exit 0}; $d=Split-Path -Parent $p; if($d -and -not (Test-Path $d)){New-Item -ItemType Directory -Path $d -Force|Out-Null}; $exists=$false; if(Test-Path $p){$exists=(Get-Content -LiteralPath $p|Where-Object{$_.Trim() -and -not $_.StartsWith('#')}|ForEach-Object{$_.Trim().ToLowerCase()}) -contains $o.ToLower()}; if(-not $exists){ if(-not (Test-Path $p)){Set-Content -LiteralPath $p -Value @('# shrink oversized — origem (um por linha)','')}; Add-Content -LiteralPath $p -Value $o }" 2>nul
set "VP_LIST_PATH="
set "VP_LIST_ORIG="
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

:cap_speed_for_small_file
if not defined ORIG_BYTES exit /b 0
if %ORIG_BYTES% GEQ %SHRINK_SMALL_BYTES% exit /b 0
echo %vel%| findstr /R /C:"^2$" /C:"^2\.0$" >nul
if errorlevel 1 exit /b 0
set "vel=1.5"
echo [META] origem ^< 400 MB ^(%ORIG_BYTES% bytes^) — velocidade limitada a 1.5x ^(maximo para ficheiros pequenos^)
call :append_work_dir_log speed_cap "%ORIG%" "^<400 MB, 2x -^> 1.5x ^(%ORIG_BYTES% bytes^)"
exit /b 0

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
echo Velocidade: 1.25, 1.5 ou 2 ^(predefinido 1.5^). Ficheiros ^< 400 MB: maximo 1.5x ^(2x e reduzido^); regista em shrink-skipped.txt.
echo Codec: auto ^(predef.^) usa a familia do original ^(H.264/HEVC^); ou h264_nvenc, libx264, hevc_nvenc, libx265.
echo   --prioritize-size: 2a passagem qualidade se reducao ^< 30%%; se saida ^> origem desiste ^(sem 3a passagem^).
echo 1a passagem: NVENC CQ rapido ^(preset %SHRINK_FAST_NVENC_PRESET%^).
echo   Sem priorizar: se reducao ^< 30%% ^(saida ^>70%% origem^), apaga shrinked, regista em data\shrink-multipass.txt e segue.
echo   Priorizar tamanho: 2a passagem qualidade se ^>70%%; se saida ^> origem apaga e desiste ^(shrink-skipped.txt^).
echo Reencode + AAC 128k — HEVC costuma gerar ficheiros menores; H.264 e mais compativel.
echo Saida: shrinked\^<nome^>.mp4
echo Marca vp_shrink_speed no ficheiro; origem ja marcada ou em shrinked\ e ignorada ^(--force repete^).
echo Se o destino ja existir, nao sobrescreve ^(use --force^).
echo.
echo Se copiou shrink_video.bat para a biblioteca, crie shrink_video.env.bat com VIDEO_PLAYER_ROOT.
echo.
exit /b 0
