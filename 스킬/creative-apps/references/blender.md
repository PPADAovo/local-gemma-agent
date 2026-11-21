# Blender 로컬 실행

**먼저 `app_script` 도구(app="blender")를 씁니다.** 실행 방식(live/background)과 미리 불러 둔 도우미 목록은 그 도구를 쓸 때 자동으로 보이는 `app-adapters/blender.md`가 기준입니다(여기에 다시 적지 않습니다). 아래 1~5의 직접 실행(`run` + `blender --background`)은 어댑터로 할 수 없는 일(가져오기·내보내기 형식 변환 등)에만 씁니다.

숫자로 정의할 수 있는 형상·치수·배치는 설치된 Blender의 Python API로 작업할 수 있습니다. 현재 화면에서의 조형·선택 또는 사용자의 기존 미저장 세션이 중요하면 먼저 UI를 확인합니다. 보이는 상태를 저장 파일과 동일하다고 가정하지 마세요.

1. `discover_tools`로 실제 blender.exe 경로를 얻습니다. `run`으로 해당 경로의 `--version`을 확인한 다음 설치 버전에 맞는 API를 사용합니다.
2. 작업 폴더 안에 Python 스크립트를 쓰고 read로 검토합니다. 입력 프로젝트 경로, 대상 객체 이름, 출력 경로를 명시합니다. 전체 장면 삭제는 새 빈 프로젝트를 만드는 요청에서만 수행합니다.
3. 배경 실행은 GUI 세션과 분리됩니다. 실제 실행 예시 형태는 `blender --background --disable-autoexec --python script.py`입니다. 실행 파일·스크립트 경로는 적절히 인용하고 shell 텍스트에 사용자 입력을 끼워 넣지 마세요. `--disable-autoexec`는 BLEND의 자동 실행을 막으며 명시적으로 전달한 Python은 실행됩니다.
4. `bpy.ops.wm.save_as_mainfile(filepath=...)`로 새 `.blend`를 저장하고 객체·치수·재질 등을 별도 JSON 보고서로 남깁니다. 입력과 출력 경로가 같으면 덮어쓰기 의도를 다시 확인합니다.
5. 두 번째 Blender 프로세스로 저장한 BLEND를 다시 열고 실제 데이터에서 검증값을 읽습니다. 작성 스크립트의 예정값을 검증값으로 복사하지 마세요. 형상·색상·구도는 뷰포트 또는 렌더 이미지도 확인합니다.

프로세스 종료 코드 0, 파일 존재, 모델 내부 값, 시각 결과는 서로 다른 검증입니다. 필요한 검증이 실패하면 결과를 고치고 다시 확인합니다. 렌더만으로 메시·재질의 편집 가능 상태를 증명하지 않습니다.

[Blender 공식 Python 실행 안내](https://docs.blender.org/api/5.0/info_tips_and_tricks.html), [스크립트 자동 실행 설정](https://docs.blender.org/manual/en/5.3/advanced/scripting/security.html), [Gotchas(연산자·context·Edit 모드)](https://docs.blender.org/api/3.6/info_gotcha.html), [배경 실행 context 충돌 버그](https://projects.blender.org/blender/blender/issues/84964). 예제 문서 버전과 설치 버전이 다르면 해당 설치 버전의 문서를 확인합니다.

## 배경 실행(bpy) 요령 — 공식 문서 Gotchas
- `bpy.ops`(연산자)는 인자가 아니라 **현재 context**에서 대상을 찾으므로 배경 실행에서 자주 실패합니다. 가능하면 `bpy.data`·`bmesh`로 데이터를 직접 만듭니다.
- 화면(OpenGL·뷰포트)이 필요한 연산자(knife_project 등)는 `--background`에서 죽을 수 있습니다(버그 보고). 쓰지 않습니다.
- 값을 바꾼 뒤 치수·모디파이어 결과를 읽기 전에 `bpy.context.view_layer.update()`.
- Edit 모드에서 고친 메쉬는 Object 모드로 나가야 `obj.data`에 반영됩니다. 배경 스크립트는 Edit 모드를 쓰지 말고 `bmesh`로.

## 화면 조작 기본 (마우스가 올라간 영역에 단축키가 적용됨)
- 이동 G, 회전 R, 크기 S → 축 X/Y/Z → **숫자 입력** → Enter (예: `G Z 0.1 Enter`). 끌어서 맞추지 않습니다.
- 추가 Shift+A, 삭제 X 또는 Delete, 복제 Shift+D, 편집/오브젝트 모드 전환 Tab.
- 시점: 숫자패드 1(앞)·3(옆)·7(위)·0(카메라), 선택 물체로 맞춤 숫자패드 `.`, 전체 Home.
- 오른쪽 N 패널에 위치·회전·크기 숫자 입력. 명령 검색 F3.
- 단위: 속성 패널 → Scene → Units(기본 미터). 저장 Ctrl+S.

## 3D 물체 만들기와 화면 조작
- 잔·컵·병·그릇·의자 같은 물체는 화면을 클릭하지 말고 `app_script`(app="blender")로 만듭니다. 도우미(lathe·tube_arc·box·cylinder·sphere 등)와 예시는 `app-adapters/blender.md`를 따릅니다. 결과의 실제 장면 물체와 렌더를 보고 고친 뒤 .blend를 열어 보여 줍니다. (예전 이름 `blender_python`도 같은 도구로 연결되지만, 예전의 make_wine_glass 같은 완성 함수는 더 이상 없습니다.)
- 화면 조작이 꼭 필요하면: 시작 화면(splash)이 떠 있으면 키가 먹지 않으므로 먼저 `esc`. 단축키는 마우스 아래 영역에 적용되므로 앱이 커서를 창 가운데(3D 뷰포트)로 옮깁니다. 삭제는 `delete`, 추가는 `shift+a` 뒤 이름을 입력(예: `cylinder`)하고 `enter`(Blender 5의 추가 메뉴는 입력 검색).
