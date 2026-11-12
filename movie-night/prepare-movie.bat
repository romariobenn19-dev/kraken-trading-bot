@echo off
title Movie Night - preparing movies
cd /d "%~dp0"
where ffmpeg >nul 2>nul || (echo FFmpeg is not installed. Run:  winget install Gyan.FFmpeg   then open this again. & pause & exit /b 1)
if "%~1"=="" (
  echo Drag one or more movie files onto this icon to prepare them.
  pause
  exit /b 0
)
:next
if "%~1"=="" goto done
node prepare.js "%~1"
shift
goto next
:done
echo.
echo All done. Your movies are ready in Movie Night.
pause
