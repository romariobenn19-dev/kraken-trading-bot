@echo off
title Movie Night
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is not installed. Run:  winget install OpenJS.NodeJS.LTS & pause & exit /b 1)
if not exist node_modules (
  echo First run: installing...
  call npm install --omit=dev
)
node server.js
pause
