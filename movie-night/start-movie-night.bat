@echo off
rem Movie Night. The desktop icon runs this in a minimised window.
rem Closing this window stops Movie Night.
title Movie Night - keep this window open (minimise it)
cd /d "%~dp0"
set "PATH=%ProgramFiles%\nodejs;%LOCALAPPDATA%\Microsoft\WinGet\Links;%PATH%"
where node >nul 2>nul || (echo Node.js is not installed. Run setup.bat first. & pause & exit /b 1)
if not exist node_modules (
  echo First run: installing...
  call npm install --omit=dev --no-audit --no-fund
)
set "MN_SUPERVISED=1"
set "MODE=%~1"
if "%MODE%"=="" set "MODE=--open"
:run
node server.js %MODE%
set "CODE=%errorlevel%"
rem 75 = restart after an update
if "%CODE%"=="75" (
  set "MODE=--restarted"
  goto run
)
rem 3 = it was already running (we just opened the page)
if "%CODE%"=="3" exit /b 0
if "%MODE%"=="--background" exit /b 0
echo.
echo   Movie Night stopped. Close this window, or press a key.
pause >nul
