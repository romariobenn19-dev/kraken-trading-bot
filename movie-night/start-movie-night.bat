@echo off
rem Shows Movie Night with a visible window (handy for troubleshooting).
rem Day to day, use the "Movie Night" desktop icon made by setup.bat instead.
title Movie Night
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is not installed. Run setup.bat first. & pause & exit /b 1)
if not exist node_modules (
  echo First run: installing...
  call npm install --omit=dev
)
node server.js --open
pause
