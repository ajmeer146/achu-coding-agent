@echo off
echo Stopping Achu Local Agent...
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*server.mjs*' -or $_.CommandLine -like '*dist\server.js*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
echo Achu Local Agent stopped.
