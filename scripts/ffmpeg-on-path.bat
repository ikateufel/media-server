@echo off
:: Define FFPROBE e FFMPEG com caminho absoluto (para FOR /F e PowerShell nao dependerem do PATH no cmd filho).
:: Chamar com CALL. Opcional: set FFMPEG_DIR=C:\ffmpeg\bin
:: Nao usar setlocal aqui.

if defined FFMPEG_DIR (
    if exist "%FFMPEG_DIR%\ffprobe.exe" set "PATH=%FFMPEG_DIR%;%PATH%"
)
if exist "C:\ffmpeg\bin\ffprobe.exe" set "PATH=C:\ffmpeg\bin;%PATH%"
if exist "%ProgramFiles%\ffmpeg\bin\ffprobe.exe" set "PATH=%ProgramFiles%\ffmpeg\bin;%PATH%"
if exist "%ProgramFiles(x86)%\ffmpeg\bin\ffprobe.exe" set "PATH=%ProgramFiles(x86)%\ffmpeg\bin;%PATH%"

set "FFPROBE="
set "FFMPEG="
for /f "delims=" %%W in ('where ffprobe.exe 2^>nul') do if not defined FFPROBE set "FFPROBE=%%W"
if not defined FFPROBE for /f "delims=" %%W in ('where ffprobe 2^>nul') do if not defined FFPROBE set "FFPROBE=%%W"

for /f "delims=" %%W in ('where ffmpeg.exe 2^>nul') do if not defined FFMPEG set "FFMPEG=%%W"
if not defined FFMPEG for /f "delims=" %%W in ('where ffmpeg 2^>nul') do if not defined FFMPEG set "FFMPEG=%%W"

if not defined FFMPEG if defined FFPROBE (
    for %%P in ("%FFPROBE%") do set "FFMPEG=%%~dpPffmpeg.exe"
)

if not defined FFPROBE goto :fail
if not exist "%FFPROBE%" goto :fail
if not exist "%FFMPEG%" goto :fail

exit /b 0

:fail
echo [ERRO] ffprobe/ffmpeg nao encontrados.
echo        Instale FFmpeg, adicione ao PATH, ou: set FFMPEG_DIR=C:\caminho\bin
exit /b 1
