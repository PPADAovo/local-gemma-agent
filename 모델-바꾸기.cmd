@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 쓸 수 있는 가장 좋은 모델 Gemma 4 26B(약 18GB)를 내려받습니다. 몇 분~수십 분 걸려요...
ollama pull gemma4:26b
if errorlevel 1 (echo 내려받기 실패: Ollama가 켜져 있는지 확인해 주세요. & pause & exit /b 1)
if exist "모델설정.json" del "모델설정.json"
echo.
echo 완료! 모델 버튼이 "자동"이면 이제 Gemma 4 26B를 씁니다.
echo 앱 입력창 오른쪽 아래 모델 버튼에서 언제든 바꿀 수 있어요.
pause
