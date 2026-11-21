@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Gemini 연결 (Antigravity CLI)
set "PATH=%LOCALAPPDATA%\Antigravity;%LOCALAPPDATA%\Antigravity\bin;%PATH%"
echo ==================================================
echo  로컬 Gemma - Gemini 섞어쓰기 연결
echo  (Google AI Pro 구독 계정으로 Antigravity CLI에 로그인)
echo ==================================================
where agy >nul 2>nul
if errorlevel 1 goto install
goto login
:install
echo.
echo [1/2] Antigravity CLI(agy)가 아직 없습니다.
echo      Google 공식 다운로드 페이지를 엽니다. 거기서 Windows용 CLI를 설치하세요.
echo      (Google 안내: AI Pro 사용자는 2026-06-18부터 Gemini CLI 대신 이 도구를 씀)
start "" "https://antigravity.google/download"
echo.
echo 설치가 끝나면 이 창을 닫고 "제미나이-연결.cmd"를 다시 실행하세요.
pause
exit /b 1
:login
echo.
echo [2/2] agy를 찾았습니다. 이제 로그인합니다.
echo      브라우저가 열리면 AI Pro를 구독한 Google 계정으로 로그인하세요.
echo      로그인이 끝나고 agy 대화 화면이 나오면 /quit 를 입력해 닫으세요.
echo.
agy
echo.
echo 연결 시험 중...
agy -p "연결 확인입니다. 딱 한 단어 OK 라고만 답하세요."
echo.
echo 위에 OK 가 보이면 연결 끝! 로컬 Gemma 모델 버튼에서 [섞어쓰기]를 고르세요.
pause
