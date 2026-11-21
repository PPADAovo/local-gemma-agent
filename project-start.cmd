@echo off
chcp 65001 >nul
setlocal
set /p "projectFolder=기존 npm 프로젝트 폴더 경로를 입력하세요 (프로젝트의 test, build 스크립트가 실행됩니다): "
if not defined projectFolder exit /b 1
set "projectFolder=%projectFolder:"=%"
node "%~dp0agent.mjs" --project "%projectFolder%"
pause
