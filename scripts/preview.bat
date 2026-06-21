@echo off

setlocal DisableDelayedExpansion

:: THUMB-MAKER (substitui o antigo slideshow em preview\).

:: Gera JPEG em .thumb_cache\ a partir dos trailers\ (mesma logica que /api/library/preview-frame).

:: O Admin/sync continua a chamar preview.bat apos trailer.bat; nao cria mais preview\*.mp4.

::

:: Requer Node + ffmpeg/ffprobe no PATH (herdados pelo processo do servidor).

set "SKIP_PAUSE=1"

for %%_ in ("%~dp0..") do set "VP_REPO_ROOT=%%~f_"

set "LIB_ROOT=%CD%"



echo ====================================================

echo   THUMB-MAKER v3 (ex preview.bat)

echo   Biblioteca: %LIB_ROOT%

echo   Saida: .thumb_cache\ (4 JPEG por trailer)

echo ====================================================



call "%~dp0ffmpeg-on-path.bat"

if errorlevel 1 (

    if not "%SKIP_PAUSE%"=="1" pause

    exit /b 1

)



pushd "%VP_REPO_ROOT%"

npx tsx scripts/warm-preview-frame-cache.ts --root="%LIB_ROOT%"
set RC=%errorlevel%
popd



if not "%SKIP_PAUSE%"=="1" pause

exit /b %RC%

