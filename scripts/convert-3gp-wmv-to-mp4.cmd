@echo off
setlocal
REM Converte .3gp, .wmv e .mov na pasta atual para .mp4 (nao recria se o .mp4 ja existir).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0convert-3gp-wmv-to-mp4.ps1" -Root "%CD%" %*
