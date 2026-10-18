@echo off
title Achu Local Agent
cd /d "%~dp0.."
echo ========================================================
echo   Achu Local Agent - Running on Port 3001
echo   Connect from https://www.workswithachu.me
echo ========================================================
echo.
"%~dp0..\bin\node.exe" "%~dp0..\server.mjs"
pause
