@echo off
setlocal
REM Lista vídeos com avisos para Silk (faststart, codec, contentor). Pasta = diretório atual.
REM Ex.: analyze-videos-for-silk.cmd
REM      cd /d D:\videos && analyze-videos-for-silk.cmd -Recurse
REM Requer ffprobe no PATH (scripts\ffmpeg-on-path.bat).

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0analyze-videos-for-silk.ps1" -Root "%CD%" %*
