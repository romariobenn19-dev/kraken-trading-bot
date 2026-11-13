@echo off
setlocal
cd /d "%~dp0"
rem Needs administrator rights once (for the firewall rule).
net session >nul 2>&1
if errorlevel 1 (
  echo Asking Windows for permission to set up Movie Night...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
title Movie Night setup
echo.
echo   Movie Night - one-time setup
echo   ============================
echo.
set "PATH=%ProgramFiles%\nodejs;%LOCALAPPDATA%\Microsoft\WinGet\Links;%PATH%"
where node >nul 2>&1
if errorlevel 1 (
  echo   Installing Node.js...
  winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
)
where ffmpeg >nul 2>&1
if errorlevel 1 (
  echo   Installing FFmpeg...
  winget install -e --id Gyan.FFmpeg --accept-source-agreements --accept-package-agreements
)
echo   Node.js and FFmpeg: OK
echo   Installing app files...
call npm install --omit=dev --no-audit --no-fund --loglevel=error
if errorlevel 1 (
  echo   npm install failed - check your internet connection and run setup again.
  pause
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-helper.ps1"
if errorlevel 1 (
  echo   Something went wrong - send a screenshot of this window.
  pause
  exit /b 1
)
echo.
echo   All set! From now on just use the "Movie Night" icon on your desktop.
echo   Movie Night also starts by itself whenever Windows starts.
echo.
pause
