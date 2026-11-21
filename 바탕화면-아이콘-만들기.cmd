@echo off
chcp 65001 >nul
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0바로가기.ps1"
echo.
echo 바탕화면과 시작 메뉴에 "로컬 Gemma" 아이콘이 생겼습니다.
pause
