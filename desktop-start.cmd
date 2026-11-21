@echo off
chcp 65001 >nul
echo 화면 모드입니다. 에이전트가 주 모니터를 보고 현재 창에 실제 클릭과 키 입력을 보낼 수 있습니다.
node "%~dp0agent.mjs" --desktop
pause
