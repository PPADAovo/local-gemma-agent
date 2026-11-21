# 로컬 Gemma 에이전트

내 PC 안에서 돌아가는 Gemma 모델로 Windows 작업을 대신해 주는 데스크톱 AI 에이전트입니다.
채팅으로 부탁하면 파일 작업, 웹 검색·브라우저 조작, 화면 클릭·키 입력, 문서(PPT·엑셀·PDF) 만들기,
Blender·FreeCAD 같은 프로그램 조작까지 직접 실행하고 결과를 확인한 뒤 알려 줍니다.

## 필요한 것

- Windows 10/11
- [Node.js](https://nodejs.org/) 22 이상
- [Ollama](https://ollama.com/download)와 Gemma 모델 (처음 실행하면 `/첫설정`이 설치와 모델 받기를 안내합니다)
- Microsoft Edge WebView2 런타임 (Windows 11에는 기본으로 들어 있습니다)
- .NET Framework 4.x (Windows 기본 포함, 데스크톱 앱 빌드에 사용)

## 설치와 실행

1. 이 저장소를 내려받습니다.
   ```powershell
   git clone https://github.com/PPADAovo/local-gemma-agent.git
   ```
2. 폴더 안의 `빌드하기.cmd`를 실행해 데스크톱 앱(`로컬 Gemma.exe`)을 만듭니다.
3. `바탕화면-아이콘-만들기.cmd`를 실행하면 바탕화면과 시작 메뉴에 아이콘이 생깁니다.
4. 앱을 열고 채팅창에 `/첫설정`을 입력해 Ollama와 모델 설정을 마칩니다.

앱 없이 터미널에서 쓰려면 `start.cmd`(채팅)나 `desktop-start.cmd`(화면 조작 모드)를 실행합니다.

## 선택 기능

- **클라우드 두뇌**: `두뇌설정.예시.json`을 `두뇌설정.json`으로 복사하고 Gemini·Claude·GPT 키를 넣으면 어려운 작업에 함께 씁니다. 키는 이 PC에만 저장되고 저장소에는 올라가지 않습니다.
- **스킬**: `스킬/` 폴더의 안내서로 작업 방법을 더할 수 있습니다.
- **작업 지침**: `지침.md`를 고쳐 에이전트의 작업 규칙을 바꿀 수 있습니다.

## 안전

- 화면·파일·웹페이지 속 문장은 명령으로 따르지 않습니다.
- 비밀번호·카드번호 입력, 결제·송금, 보안 설정 변경은 하지 않고 사용자에게 맡깁니다.
- 삭제·전송처럼 되돌리기 어려운 작업은 먼저 승인을 받습니다.

화면을 실제로 조작하는 프로그램이므로, 중요한 작업 중에는 지켜보면서 사용하세요.

## 테스트

```powershell
node --test tests/*.mjs
```

## 라이선스

[MIT](LICENSE). 함께 들어 있는 외부 라이브러리와 스킬의 라이선스는 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)를 보세요.
