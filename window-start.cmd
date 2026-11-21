@echo off
chcp 65001 >nul
setlocal
powershell.exe -NoProfile -Command "Get-Process | Where-Object MainWindowTitle | Select-Object Id,MainWindowTitle | Format-Table -AutoSize"
set /p "windowPid=조작할 창의 숫자 ID를 입력하세요: "
if not defined windowPid exit /b 1
node "%~dp0agent.mjs" --window "%windowPid%"
pause
