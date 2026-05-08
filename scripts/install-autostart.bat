@echo off
setlocal
cd /d "%~dp0"

set "TARGET_VBS=%CD%\start-with-windows.vbs"
set "STARTUP_DIR=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "SHORTCUT=%STARTUP_DIR%\video_player.lnk"

if not exist "%TARGET_VBS%" (
  echo [erro] %TARGET_VBS% nao existe.
  exit /b 1
)

if not exist "%STARTUP_DIR%" (
  echo [erro] Pasta Startup nao encontrada: %STARTUP_DIR%
  exit /b 1
)

set "TMP_PS=%TEMP%\video_player_install_autostart.ps1"
> "%TMP_PS%" echo $ws = New-Object -ComObject WScript.Shell
>> "%TMP_PS%" echo $sc = $ws.CreateShortcut('%SHORTCUT%')
>> "%TMP_PS%" echo $sc.TargetPath = 'wscript.exe'
>> "%TMP_PS%" echo $sc.Arguments = '"%TARGET_VBS%"'
>> "%TMP_PS%" echo $sc.WorkingDirectory = '%CD%'
>> "%TMP_PS%" echo $sc.WindowStyle = 7
>> "%TMP_PS%" echo $sc.Description = 'video_player auto-start'
>> "%TMP_PS%" echo $sc.Save()

powershell -NoProfile -ExecutionPolicy Bypass -File "%TMP_PS%"
set "RC=%ERRORLEVEL%"
del "%TMP_PS%" >nul 2>&1

if "%RC%" neq "0" (
  echo [erro] Falhou a criar o atalho ^(rc=%RC%^).
  exit /b %RC%
)

echo [ok] Atalho criado em:
echo     %SHORTCUT%
echo.
echo Para desinstalar: apaga esse atalho ou corre   uninstall-autostart.bat
endlocal
exit /b 0
