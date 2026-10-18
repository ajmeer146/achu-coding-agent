@echo off
echo Restarting Achu Local Agent...
call "%~dp0stop-agent.bat"
timeout /t 1 /nobreak >nul
wscript "%~dp0start-agent.vbs"
echo Achu Local Agent started on http://127.0.0.1:3001.
