@echo off

setlocal DisableDelayedExpansion
:: CONFIG (ASCII)
set "vel=2.0"
set "pts=0.5"
set "H_TRAILER=540"
set "SKIP_PAUSE=1"
:: Encoder de video: 0=libx264 (CPU), 1=h264_nvenc (NVIDIA), auto=tenta NVENC e cai para libx264.
set "USE_NVENC=auto"
:: Preset NVENC (so se NVENC ficar escolhido). p4=equilibrado; p7=mais rapido (qualidade/tamanho um pouco piores).
if not defined TRAILER_NVENC_PRESET set "TRAILER_NVENC_PRESET=p4"
:: Pasta temporaria (segmentos + lista concat).
:: Ordem de precedencia TRAILER_TEMP:
::   1) JA definido no ambiente (.env herdado pelo processo CMD)
::   2) VIDEO_BAT_TEMP\\trailer (VIDEO_BAT_TEMP no .env opcional - ver .env.example)
::   3) <raiz do repo>\\data\\bat-work\\trailer (raiz = pasta pai de scripts\\)
:: Falha criar pasta -> %%TEMP%%\vp-trailer-* (aleatorio).
::
:: Log (append): uma linha por ficheiro = caminho absoluto do video em processamento.
for %%_ in ("%~dp0..") do set "VP_REPO_ROOT=%%~f_"
if not "%VIDEO_BAT_TEMP%"=="" if "%TRAILER_TEMP%"=="" set "TRAILER_TEMP=%VIDEO_BAT_TEMP%\trailer"
if "%TRAILER_TEMP%"=="" set "TRAILER_TEMP=%VP_REPO_ROOT%\data\bat-work\trailer"
if not exist "%TRAILER_TEMP%" mkdir "%TRAILER_TEMP%" 2>nul
if not exist "%TRAILER_TEMP%" (
  set "TRAILER_TEMP=%TEMP%\vp-trailer-%RANDOM%%RANDOM%%RANDOM%%RANDOM%"
)
:: PROCESSAMENTO PADRAO (unico; Admin/sync chama trailer.bat sem argumentos):
::   15 s em 2x a cada 5%% do filme se duracao ^<= TRAILER_LONG_MIN_SEC (60 min)
::   15 s em 2x a cada TRAILER_LONG_STEP_SEC (5 min) se duracao ^> 60 min
:: Ajuste fino via .env: TRAILER_PCT_SEG, TRAILER_PCT_STEP, TRAILER_LONG_MIN_SEC, TRAILER_LONG_STEP_SEC
:: TRAILER_MODE no .env e ignorado (valores minuto* nao mudam o algoritmo).
if not defined TRAILER_PCT_SEG set "TRAILER_PCT_SEG=15"
if not defined TRAILER_PCT_STEP set "TRAILER_PCT_STEP=5"
if not defined TRAILER_LONG_MIN_SEC set "TRAILER_LONG_MIN_SEC=3600"
if not defined TRAILER_LONG_STEP_SEC set "TRAILER_LONG_STEP_SEC=300"
:: Modos legado: so com argumento explicito na linha de comando (nao via .env).
if not defined TRAILER_MAX_OUT_SEC set "TRAILER_MAX_OUT_SEC=120"
set "TRAILER_COLLECT=padrao"
if /I "%~1"=="minuto10" set "TRAILER_COLLECT=minuto10"
if /I "%~1"=="--minuto10" set "TRAILER_COLLECT=minuto10"
if /I "%~1"=="minuto15" set "TRAILER_COLLECT=minuto15"
if /I "%~1"=="--minuto15" set "TRAILER_COLLECT=minuto15"
if /I "%~1"=="minuto20" set "TRAILER_COLLECT=minuto20"
if /I "%~1"=="--minuto20" set "TRAILER_COLLECT=minuto20"
if /I "%~1"=="sparse" set "TRAILER_COLLECT=sparse"
if /I "%~1"=="--sparse" set "TRAILER_COLLECT=sparse"
if /I "%~1"=="legacy" set "TRAILER_COLLECT=sparse"

echo ====================================================
echo   TRAILER-MAKER v3.7 (mp4 mkv m4v avi mov webm wmv na raiz - saida trailers\*.mp4)
echo   TRAILER temp: %TRAILER_TEMP%
if /I "%TRAILER_COLLECT%"=="padrao" echo   COLETA PADRAO: %TRAILER_PCT_SEG%s em 2x — cada %TRAILER_PCT_STEP%%% se ^<=%TRAILER_LONG_MIN_SEC%s\, cada %TRAILER_LONG_STEP_SEC%s se maior
if /I not "%TRAILER_COLLECT%"=="padrao" echo   COLETA LEGADO: %TRAILER_COLLECT% ^(so por argumento CLI^)
if /I not "%TRAILER_COLLECT%"=="padrao" echo   Duracao maxima saida legado: %TRAILER_MAX_OUT_SEC%s (apos 2x)
echo ====================================================

if not exist "%TRAILER_TEMP%" mkdir "%TRAILER_TEMP%"
if not exist "%VP_REPO_ROOT%\data" mkdir "%VP_REPO_ROOT%\data" 2>nul
if not exist "trailers" mkdir "trailers"
if not exist "preview" mkdir "preview"

call "%~dp0ffmpeg-on-path.bat"
if errorlevel 1 (
    if not "%SKIP_PAUSE%"=="1" pause
    exit /b 1
)

:: Decide encoder: libx264 (-tune zerolatency: mais rapido em clipes curtos) vs h264_nvenc (%TRAILER_NVENC_PRESET%, cq 26).
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

for %%f in (*.mp4 *.mkv *.m4v *.avi *.mov *.webm *.wmv) do (
    set "orig=%%f"
    set "nome=%%~nf"

    setlocal EnableDelayedExpansion
    echo "!orig!" | findstr /I "zz_" >nul

    if !errorlevel! NEQ 0 if not exist "trailers\!nome!.mp4" (
        echo.
        for %%F in ("!orig!") do echo [PROCESSANDO] %%~fF
        for %%F in ("!orig!") do >>"%VP_REPO_ROOT%\data\sync-bat-processing.log" echo %%~fF

        rem Evitar FOR /F IN['...'] com exe entre aspas: o cmd filho da erro 123.
        rem Probe em TRAILER_TEMP (%CD%-relativo por defeito) em vez so de %%TEMP%%:
        rem a cmd herdada do Node as vezes nao ve a mesma drive que %TEMP%.
        set "_pout=!TRAILER_TEMP!\probe_!random!_!random!.txt"
        "!FFPROBE!" -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "!orig!" > "!_pout!" 2>nul
        set "dur_raw="
        for /f "usebackq tokens=*" %%i in ("!_pout!") do set "dur_raw=%%i"
        del "!_pout!" >nul 2>&1

        set "DUR_INT="
        if defined dur_raw (
            set "ENV_DUR_RAW=!dur_raw!"
            for /f "delims=" %%D in ('powershell -NoProfile -Command "$r = $env:ENV_DUR_RAW.Trim(); if (-not $r) { exit 1 }; $r = $r -replace ',','.'; [int][math]::Floor([double]::Parse($r, [cultureinfo]::InvariantCulture))"') do set "DUR_INT=%%D"
            set "ENV_DUR_RAW="
        )

        if defined DUR_INT if !DUR_INT! GTR 0 (

            set "tid=!RANDOM!!RANDOM!!RANDOM!"
            set "LISTA=!TRAILER_TEMP!\list_!tid!.txt"
            set "SEG_COUNT=0"
            if exist "!LISTA!" del "!LISTA!"

            REM MKV sem audio ou com codec que atempo nao aceita: falhavam todos os cortes a seguir ao primeiro
            set "HAS_A=0"
            set "_pout=!TRAILER_TEMP!\probe_!random!_!random!.txt"
            "!FFPROBE!" -v error -select_streams a:0 -show_entries stream=index -of csv=p=0 "!orig!" > "!_pout!" 2>nul
            for /f "usebackq delims=" %%A in ("!_pout!") do set "HAS_A=1"
            del "!_pout!" >nul 2>&1

            REM scale so desce: min(ih,H) na altura, fica no-op se ja for <= H_TRAILER;
            REM bilinear poupa muito CPU vs lanczos com diferenca imperceptivel num trailer.
            REM \, escapa a virgula dentro do filter-graph (separador de filtros).
            set "VF_CHAIN=setpts=%pts%*PTS,scale=-2:min(ih\,%H_TRAILER%):flags=bilinear"
            set "AF_CHAIN=aresample=async=1:first_pts=0,atempo=%vel%"

            if /I "!TRAILER_COLLECT!"=="padrao" (
                set /a "PCT_SEG=!TRAILER_PCT_SEG!"
                set /a "PCT_STEP=!TRAILER_PCT_STEP!"
                set /a "LONG_MIN=!TRAILER_LONG_MIN_SEC!"
                set /a "LONG_STEP=!TRAILER_LONG_STEP_SEC!"
                if !PCT_SEG! LSS 1 set /a "PCT_SEG=15"
                if !PCT_STEP! LSS 1 set /a "PCT_STEP=5"
                if !LONG_MIN! LSS 1 set /a "LONG_MIN=3600"
                if !LONG_STEP! LSS 60 set /a "LONG_STEP=300"

                if !DUR_INT! GTR !LONG_MIN! (
                    set /a "max_m=( !DUR_INT! - 1 ) / !LONG_STEP!"
                    if !max_m! LSS 0 set /a "max_m=0"
                    set /a "npc=!max_m!+1"
                    echo [META] padrao-longo: filme ~!DUR_INT!s ^(ffprobe !dur_raw!^) - !PCT_SEG!s em 2x a cada !LONG_STEP!s ^(!npc! cortes^) ^| setpts=!pts!*PTS\, atempo=!vel!

                    for /L %%m in (0,1,!max_m!) do (
                        set /a "st=%%m*!LONG_STEP!"
                        set /a "seg_t=!PCT_SEG!"
                        set /a "rem=!DUR_INT!-!st!"
                        if !rem! LSS !seg_t! set /a "seg_t=!rem!"
                        if !seg_t! GTR 0 (
                            set "tmp=!TRAILER_TEMP!\tm_%%m_!tid!.mp4"
                            if "!HAS_A!"=="1" (
                                "!FFMPEG!" -y -ss !st! -t !seg_t! -i "!orig!" -filter_complex "[0:v]!VF_CHAIN![v];[0:a]!AF_CHAIN![a]" -map "[v]" -map "[a]" !VENC_ARGS! -c:a aac -b:a 128k -threads 0 "!tmp!" >nul 2>&1
                            ) else (
                                "!FFMPEG!" -y -ss !st! -t !seg_t! -i "!orig!" -vf "!VF_CHAIN!" -an !VENC_ARGS! -threads 0 "!tmp!" >nul 2>&1
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
                                )
                            )
                        )
                    )
                ) else (
                    set /a "pct_max=100-!PCT_STEP!"
                    if !pct_max! LSS 0 set /a "pct_max=0"
                    set /a "npc=!pct_max!/!PCT_STEP!+1"
                    echo [META] padrao: filme ~!DUR_INT!s ^(ffprobe !dur_raw!^) - !PCT_SEG!s em 2x a cada !PCT_STEP!%% ^(!npc! cortes 0-!pct_max!%%^) ^| setpts=!pts!*PTS\, atempo=!vel!

                    for /L %%p in (0,!PCT_STEP!,!pct_max!) do (
                        set /a "st=!DUR_INT!*%%p/100"
                        set /a "seg_t=!PCT_SEG!"
                        set /a "rem=!DUR_INT!-!st!"
                        if !rem! LSS !seg_t! set /a "seg_t=!rem!"
                        if !seg_t! GTR 0 (
                            set "tmp=!TRAILER_TEMP!\tp_%%p_!tid!.mp4"
                            if "!HAS_A!"=="1" (
                                "!FFMPEG!" -y -ss !st! -t !seg_t! -i "!orig!" -filter_complex "[0:v]!VF_CHAIN![v];[0:a]!AF_CHAIN![a]" -map "[v]" -map "[a]" !VENC_ARGS! -c:a aac -b:a 128k -threads 0 "!tmp!" >nul 2>&1
                            ) else (
                                "!FFMPEG!" -y -ss !st! -t !seg_t! -i "!orig!" -vf "!VF_CHAIN!" -an !VENC_ARGS! -threads 0 "!tmp!" >nul 2>&1
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
                                )
                            )
                        )
                    )
                )
            ) else (
            set "MINUTO_SEG="
            set "MINUTO_TAIL="
            if /I "!TRAILER_COLLECT!"=="minuto10" (
                set "MINUTO_SEG=10"
                set "MINUTO_TAIL=60"
            )
            if /I "!TRAILER_COLLECT!"=="minuto15" (
                set "MINUTO_SEG=15"
                set "MINUTO_TAIL=90"
            )
            if /I "!TRAILER_COLLECT!"=="minuto20" (
                set "MINUTO_SEG=20"
                set "MINUTO_TAIL=120"
            )
            if defined MINUTO_SEG (
                REM Teto total (saida 2x): evita trailers enormes em filmes longos.
                set /a "MAX_OUT=!TRAILER_MAX_OUT_SEC!"
                set /a "MAX_SRC=!MAX_OUT!*2"
                set /a "TAIL_SRC=!MINUTO_TAIL!"
                if !TAIL_SRC! GTR !MAX_SRC! set /a "TAIL_SRC=!MAX_SRC!"
                set /a "BUDGET_SRC=!MAX_SRC!-!TAIL_SRC!"
                REM Ns a partir de mm:00 (cada minuto), sem invadir os ultimos MINUTO_TAIL s; depois bloco final.
                set /a "f_ini=!DUR_INT!-!MINUTO_TAIL!"
                if !f_ini! LSS 0 set /a "f_ini=0"
                set /a "f_len=!DUR_INT!-!f_ini!"
                if !f_len! GTR !TAIL_SRC! set /a "f_len=!TAIL_SRC!"
                set /a "max_m=-1"
                if !BUDGET_SRC! GEQ !MINUTO_SEG! set /a "max_m=(!BUDGET_SRC!-!MINUTO_SEG!)/60"
                set /a "npc=0"
                if !max_m! GEQ 0 set /a "npc=!max_m!+1"
                echo [META] !TRAILER_COLLECT!: filme ~!DUR_INT!s ^(ffprobe !dur_raw!^) - !npc! x !MINUTO_SEG!s ^(inicio de cada minuto^) + !f_len!s finais ^(teto saida !MAX_OUT!s^) ^| 2x ^(setpts=!pts!*PTS\, atempo=!vel!^)

                for /L %%m in (0,1,!max_m!) do (
                    set /a "st=%%m*60"
                    set /a "seg_t=!MINUTO_SEG!"
                    set /a "rem=!DUR_INT!-!st!"
                    if !rem! LSS !seg_t! set /a "seg_t=!rem!"
                    if !seg_t! GTR 0 (
                        set "tmp=!TRAILER_TEMP!\tq_%%m_!tid!.mp4"
                        if "!HAS_A!"=="1" (
                            "!FFMPEG!" -y -ss !st! -t !seg_t! -i "!orig!" -filter_complex "[0:v]!VF_CHAIN![v];[0:a]!AF_CHAIN![a]" -map "[v]" -map "[a]" !VENC_ARGS! -c:a aac -b:a 128k -threads 0 "!tmp!" >nul 2>&1
                        ) else (
                            "!FFMPEG!" -y -ss !st! -t !seg_t! -i "!orig!" -vf "!VF_CHAIN!" -an !VENC_ARGS! -threads 0 "!tmp!" >nul 2>&1
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
                            )
                        )
                    )
                )

                set "tmp_f=!TRAILER_TEMP!\t_fin_!tid!.mp4"
                if "!HAS_A!"=="1" (
                    "!FFMPEG!" -y -ss !f_ini! -t !f_len! -i "!orig!" -filter_complex "[0:v]!VF_CHAIN![v];[0:a]!AF_CHAIN![a]" -map "[v]" -map "[a]" !VENC_ARGS! -c:a aac -b:a 128k -threads 0 "!tmp_f!" >nul 2>&1
                ) else (
                    "!FFMPEG!" -y -ss !f_ini! -t !f_len! -i "!orig!" -vf "!VF_CHAIN!" -an !VENC_ARGS! -threads 0 "!tmp_f!" >nul 2>&1
                )
                if exist "!tmp_f!" (
                    "!FFPROBE!" -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "!tmp_f!" >nul 2>&1
                    if errorlevel 1 (
                        echo [AVISO] segmento final invalido ignorado: !tmp_f!
                        del "!tmp_f!" >nul 2>&1
                    ) else (
                        set "tmpfSlash=!tmp_f:\=/!"
                        echo file '!tmpfSlash!' >> "!LISTA!"
                        set /a "SEG_COUNT+=1"
                    )
                )
            ) else if /I "!TRAILER_COLLECT!"=="sparse" (
            REM Modo antigo: 25s a cada 90s, em 2x (setpts/atempo já definidos), com teto TRAILER_MAX_OUT_SEC.
            set /a "MAX_OUT=!TRAILER_MAX_OUT_SEC!"
            set /a "MAX_SRC=!MAX_OUT!*2"
            set /a "STEP=90"
            set /a "tempo=25"
            set /a "budget_sparse=!MAX_SRC!-!tempo!"
            if !budget_sparse! LSS 0 set /a "budget_sparse=0"
            set /a "max_i=!budget_sparse!/!STEP!"
            if !max_i! LSS 0 set /a "max_i=0"
            echo [META] sparse: filme ~!DUR_INT!s ^(ffprobe !dur_raw!^) - cortes de !tempo!s a cada !STEP!s ^(max !max_i!+1^) teto saida !MAX_OUT!s ^| 2x ^(setpts=!pts!*PTS\, atempo=!vel!^)

            set "LAST_START=-1"
            for /L %%i in (0,1,!max_i!) do (
                set /a "start=%%i*!STEP!"
                set /a "seg_t=!tempo!"
                set /a "rem=!DUR_INT!-!start!"
                if !rem! LSS !seg_t! set /a "seg_t=!rem!"
                if !seg_t! GTR 0 (
                    set "tmp=!TRAILER_TEMP!\t_%%i_!tid!.mp4"
                    REM -ss antes de -i = fast seek por keyframe (preciso porque estamos a re-codificar).
                    if "!HAS_A!"=="1" (
                        "!FFMPEG!" -y -ss !start! -t !seg_t! -i "!orig!" -filter_complex "[0:v]!VF_CHAIN![v];[0:a]!AF_CHAIN![a]" -map "[v]" -map "[a]" !VENC_ARGS! -c:a aac -b:a 128k -threads 0 "!tmp!" >nul 2>&1
                    ) else (
                        "!FFMPEG!" -y -ss !start! -t !seg_t! -i "!orig!" -vf "!VF_CHAIN!" -an !VENC_ARGS! -threads 0 "!tmp!" >nul 2>&1
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
                        )
                    )

                    set "LAST_START=!start!"
                )
            )

            REM Garantir um corte final (últimos 15s) se o passo não aterrar no fim.
            set /a "f_ini=!DUR_INT! - !tempo!"
            if !f_ini! LSS 0 set /a "f_ini=0"
            if not "!LAST_START!"=="!f_ini!" (
                set "tmp_f=!TRAILER_TEMP!\t_fin_!tid!.mp4"
                if "!HAS_A!"=="1" (
                    "!FFMPEG!" -y -ss !f_ini! -t !tempo! -i "!orig!" -filter_complex "[0:v]!VF_CHAIN![v];[0:a]!AF_CHAIN![a]" -map "[v]" -map "[a]" !VENC_ARGS! -c:a aac -b:a 128k -threads 0 "!tmp_f!" >nul 2>&1
                ) else (
                    "!FFMPEG!" -y -ss !f_ini! -t !tempo! -i "!orig!" -vf "!VF_CHAIN!" -an !VENC_ARGS! -threads 0 "!tmp_f!" >nul 2>&1
                )

                if exist "!tmp_f!" (
                    "!FFPROBE!" -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "!tmp_f!" >nul 2>&1
                    if errorlevel 1 (
                        echo [AVISO] segmento final invalido ignorado: !tmp_f!
                        del "!tmp_f!" >nul 2>&1
                    ) else (
                        set "tmpfSlash=!tmp_f:\=/!"
                        echo file '!tmpfSlash!' >> "!LISTA!"
                        set /a "SEG_COUNT+=1"
                    )
                )
            )
            ) else (
                echo [ERRO] modo TRAILER_COLLECT desconhecido: !TRAILER_COLLECT!
            )
            )

            if !SEG_COUNT! GTR 0 (
                if exist "!LISTA!" (
                    echo [UNIR] a juntar segmentos ^(copia rapida -c copy^)...
                    set "trailOut=trailers\!nome!.mp4"
                    if exist "!trailOut!" del "!trailOut!" >nul 2>&1
                    set "clog=!TRAILER_TEMP!\concat_!tid!.log"
                    rem +genpts comum em corriger PTS ao juntar varios cortes mp4 sem re-encoding
                    "!FFMPEG!" -y -hide_banner -loglevel error -fflags +genpts -f concat -safe 0 -i "!LISTA!" -c copy "!trailOut!" >"!clog!" 2>&1
                    set "CONCAT_OK=0"
                    if not errorlevel 1 if exist "!trailOut!" (
                        "!FFPROBE!" -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "!trailOut!" >nul 2>&1
                        if not errorlevel 1 set "CONCAT_OK=1"
                    )
                    if "!CONCAT_OK!"=="1" (
                        del "!clog!" >nul 2>&1
                        echo [OK] !trailOut! criado.
                    ) else (
                        echo [AVISO] -c copy falhou ^(timing/streams entre cortes diferem deste MKV - ex.: ~!orig!~^) - uniao com libx264 ^(demora mais^)...
                        if "!HAS_A!"=="1" (
                            "!FFMPEG!" -y -hide_banner -loglevel error -fflags +genpts -f concat -safe 0 -i "!LISTA!" -vf format=yuv420p -c:v libx264 -preset superfast -tune zerolatency -crf 26 -c:a aac -b:a 128k -movflags +faststart "!trailOut!" >"!clog!" 2>&1
                        ) else (
                            "!FFMPEG!" -y -hide_banner -loglevel error -fflags +genpts -f concat -safe 0 -i "!LISTA!" -vf format=yuv420p -c:v libx264 -preset superfast -tune zerolatency -crf 26 -an -movflags +faststart "!trailOut!" >"!clog!" 2>&1
                        )
                        set "CONCAT_OK=0"
                        if not errorlevel 1 if exist "!trailOut!" (
                            "!FFPROBE!" -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "!trailOut!" >nul 2>&1
                            if not errorlevel 1 set "CONCAT_OK=1"
                        )
                        if "!CONCAT_OK!"=="1" (
                            del "!clog!" >nul 2>&1
                            echo [OK] !trailOut! criado ^(via re-encoding^).
                        ) else (
                            echo [ERRO] falha ao unir segmentos ^(ffmpeg^).
                            echo [DET] log: !clog!
                        )
                    )
                ) else (
                    echo [ERRO] lista de segmentos nao foi criada.
                )
            ) else (
                echo [ERRO] nenhum segmento valido foi gerado.
            )
            del /q "!TRAILER_TEMP!\t_*_!tid!.mp4" "!TRAILER_TEMP!\tq_*_!tid!.mp4" "!TRAILER_TEMP!\tp_*_!tid!.mp4" "!TRAILER_TEMP!\tm_*_!tid!.mp4" "!TRAILER_TEMP!\t_fin_!tid!.mp4" >nul 2>&1
            del /q "!LISTA!" >nul 2>&1
        )
    )
    endlocal
)

if not "%SKIP_PAUSE%"=="1" pause

echo "Trailer finished"

