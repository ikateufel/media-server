@echo off
setlocal DisableDelayedExpansion
:: PREVIEW-MAKER (ASCII)
:: Gera preview\^<nome^>.mp4 a partir do filme na raiz, se existir trailers\^<nome^>.mp4.
:: d_frame = segundos por imagem no slideshow final. H_PREVIEW = altura px (0 = sem scale, mais pesado).
:: SKIP_PAUSE=1 evita pause no fim (util se o CMD vier do Node/servicos).
:: USE_NVENC: 0=libx264, 1=NVENC, auto=prova NVENC e cai para CPU.
::
:: Temp (JPEGs + lst): preview_work, ou VIDEO_BAT_TEMP\preview, ou irma de TRAILER_TEMP\..\preview,
:: ou %%VP_REPO_ROOT%%\data\bat-work\preview; falha -> %%TEMP%%\vp-preview-*.
::
:: Log (append): uma linha = caminho absoluto do video.
set "d_frame=0.2"
set "H_PREVIEW=240"
set "crf=26"
set "preset=superfast"
set "SKIP_PAUSE=1"
set "USE_NVENC=auto"

for %%_ in ("%~dp0..") do set "VP_REPO_ROOT=%%~f_"
if "%preview_work%"=="" if not "%VIDEO_BAT_TEMP%"=="" (
  set "preview_work=%VIDEO_BAT_TEMP%\preview"
)
if "%preview_work%"=="" if not "%TRAILER_TEMP%"=="" (
  for %%I in ("%TRAILER_TEMP%\..") do set "preview_work=%%~fI\preview"
)
if "%preview_work%"=="" set "preview_work=%VP_REPO_ROOT%\data\bat-work\preview"
if not exist "%preview_work%" mkdir "%preview_work%" 2>nul
if not exist "%preview_work%" (
  set "preview_work=%TEMP%\vp-preview-%RANDOM%%RANDOM%%RANDOM%%RANDOM%"
)
if not exist "%preview_work%" mkdir "%preview_work%"

if not exist "%VP_REPO_ROOT%\data" mkdir "%VP_REPO_ROOT%\data" 2>nul

echo ====================================================
echo   PREVIEW-MAKER v2 - temp: %preview_work%
echo   %d_frame%s por imagem - saida .\preview\^<mesmo_nome_que_trailer^>.mp4 ^(%H_PREVIEW%p^)
echo ====================================================
if not exist "trailers" mkdir "trailers"
if not exist "preview" mkdir "preview"

call "%~dp0ffmpeg-on-path.bat"
if errorlevel 1 (
    if not "%SKIP_PAUSE%"=="1" pause
    exit /b 1
)

set "VENC_ARGS=-c:v libx264 -preset %preset% -crf %crf%"
if /I "%USE_NVENC%"=="1" goto :pick_nvenc
if /I not "%USE_NVENC%"=="auto" goto :encoder_done
"%FFMPEG%" -hide_banner -loglevel error -f lavfi -i color=c=black:s=256x144:r=1 -frames:v 1 -c:v h264_nvenc -f null NUL >nul 2>&1
if errorlevel 1 (
    echo [INFO] NVENC indisponivel - a usar libx264 ^(CPU^).
    goto :encoder_done
)
:pick_nvenc
set "VENC_ARGS=-c:v h264_nvenc -preset p4 -rc vbr -cq %crf% -b:v 0"
echo [INFO] Encoder final: h264_nvenc.
:encoder_done

for %%f in (*.mp4 *.mkv *.m4v *.avi *.mov *.webm) do (
    set "orig=%%f"
    set "nome=%%~nf"
    setlocal EnableDelayedExpansion
    echo "!orig!" | findstr /I "zz_" >nul
    if !errorlevel! NEQ 0 if exist "trailers\!nome!.mp4" if not exist "preview\!nome!.mp4" (
        echo.
        for %%C in (".") do set "movroot=%%~fC"
        for %%F in ("!orig!") do echo [PREVIEW] %%~fF
        for %%F in ("!orig!") do >>"%VP_REPO_ROOT%\data\sync-bat-processing.log" echo %%~fF
        set "trailout=!movroot!\preview\!nome!.mp4"
        set "dur="
        set "_pout=!preview_work!\probe_dur_!random!_!random!.txt"
        "!FFPROBE!" -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "!orig!" > "!_pout!" 2>nul
        for /f "usebackq tokens=*" %%i in ("!_pout!") do set "dur=%%i"
        del "!_pout!" >nul 2>&1
        if defined dur set "dur=!dur:,=.!"
        if "!dur!"=="" (
            echo [ERRO] Duracao invalida.
        ) else (
            set "pwork=!preview_work!\pvw_!random!!random!"
            mkdir "!pwork!" 2>nul
            rem Timestamps numa so chamada ao PowerShell; cada frame mantem -ss antes de -i ^(seek rapido, sem decodificar o filme inteiro^).
            set "ENV_PREVIEW_DUR=!dur!"
            set "ENV_PWORK=!pwork!"
            powershell -NoProfile -Command "& { $d=[double]::Parse($env:ENV_PREVIEW_DUR.Trim(),[cultureinfo]::InvariantCulture); if ($d -le 0) { exit 1 }; $p=$env:ENV_PWORK; (1..100) | ForEach-Object { [math]::Min([math]::Max(0.0,$d*($_-0.5)/100.0),[math]::Max(0.001,$d-0.05)).ToString('G20',[cultureinfo]::InvariantCulture) } | Set-Content -LiteralPath (Join-Path $p 'times.txt') -Encoding ascii }"
            if errorlevel 1 (
                echo [ERRO] PowerShell nao conseguiu calcular timestamps.
                set "ENV_PREVIEW_DUR="
                set "ENV_PWORK="
                rd /s /q "!pwork!" 2>nul
            ) else (
                set "ENV_PREVIEW_DUR="
                set "ENV_PWORK="
                if not exist "!pwork!\times.txt" (
                    echo [ERRO] falta times.txt apos PowerShell.
                    rd /s /q "!pwork!" 2>nul
                ) else (
            echo [1/2] 100 imagens -^> !pwork! ^(seek+raster bilinear^) ...
            set "nn=0"
            for /f "usebackq delims=" %%s in ("!pwork!\times.txt") do (
                set /a nn+=1
                if "!H_PREVIEW!"=="0" (
                    "!FFMPEG!" -hide_banner -loglevel error -y -ss %%s -i "!orig!" -frames:v 1 -q:v 4 -threads 0 "!pwork!\f_!nn!.jpg" 2>nul
                ) else (
                    "!FFMPEG!" -hide_banner -loglevel error -y -ss %%s -i "!orig!" -frames:v 1 -vf "scale=-2:!H_PREVIEW!:flags=bilinear" -q:v 4 -threads 0 "!pwork!\f_!nn!.jpg" 2>nul
                )
            )
            del "!pwork!\times.txt" >nul 2>&1
            set "_first="
            set "lastf="
            for /l %%p in (1,1,100) do (
                if exist "!pwork!\f_%%p.jpg" (
                    if not defined _first set "_first=f_%%p.jpg"
                    set "lastf=f_%%p.jpg"
                )
            )
            if not defined _first (
                echo [ERRO] Nenhuma imagem extraida.
                rd /s /q "!pwork!" 2>nul
            ) else (
                echo [2/2] concat -^> !trailout!
                >"!pwork!\lst.txt" echo ffconcat version 1.0
                for /l %%p in (1,1,100) do (
                    if exist "!pwork!\f_%%p.jpg" (
                        >>"!pwork!\lst.txt" echo file 'f_%%p.jpg'
                        >>"!pwork!\lst.txt" echo duration !d_frame!
                    )
                )
                >>"!pwork!\lst.txt" echo file '!lastf!'
                set "encLog=!pwork!\encode.log"
                pushd "!pwork!"
                rem +genpts: PTS estavel com concat de imagens
                "!FFMPEG!" -y -hide_banner -loglevel error -fflags +genpts -f concat -safe 0 -i lst.txt -vf "format=yuv420p" !VENC_ARGS! -threads 0 -movflags +faststart -an "!trailout!" >"!encLog!" 2>&1
                popd
                if exist "!trailout!" (
                    echo [OK] preview\!nome!.mp4
                    del "!encLog!" >nul 2>&1
                ) else (
                    echo [ERRO] concat/encode falhou.
                    echo [DET] log: !encLog!
                )
                rd /s /q "!pwork!" 2>nul
            )
            )
            )
        )
    )
    endlocal
)
echo.
if not "%SKIP_PAUSE%"=="1" pause

