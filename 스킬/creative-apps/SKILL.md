---
name: creative-apps
description: Premiere·Photoshop·After Effects·Illustrator·Blender·AutoCAD·FreeCAD·SolidWorks·Inventor·Fusion·Rhino·SketchUp·Revit·KiCad·DXF 도면 등 로컬 설계·편집 앱을 코드(스크립트·API) 또는 화면으로 조작해 편집 가능한 프로젝트를 만들거나 수정하고 결과를 검증합니다.
---

# 설계·편집 앱 작업

사용자가 지정한 앱, 프로젝트, 수정할 대상, 결과 형식과 보존 조건을 먼저 정리하세요. 이미 대화나 파일에 있는 정보는 다시 묻지 않습니다.

1. `discover_tools`에 앱 이름 또는 `creative`를 보내 실제 실행 파일과 지원 경로를 확인합니다. 기본 루프는 text, 단순 루프는 query 필드입니다. 설치 경로나 앱 이름만으로 API 연결이 되었다고 말하지 마세요.
2. 읽기 가능한 입력 파일과 출력 위치를 확인하고, 필요한 프로그램·스킬을 로컬에서 찾습니다. 편집 프로젝트를 요구했으면 PSD/AI/AEP/PRPROJ/BLEND/DWG 등 해당 원본 형식과 검증 항목을 계획에 포함합니다.
3. 대상 앱의 문서화된 로컬 스크립트/API가 설치 버전에서 실제 실행 가능하면 우선 사용합니다. 발견되지 않은 플러그인·UXP·COM 이름을 지어내지 마세요. Premiere 2020에는 Premiere 25.6용 UXP를 보내지 않습니다. 스크립트는 대상 문서를 검사하고 요청된 변경만 수행하도록 작성합니다.
4. API 연결이 없거나 작업을 지원하지 않으면 `windows` → `focus` → `look`으로 대상 화면을 봅니다. 메뉴·패널·선택 객체·활성 타임라인을 확인하고 다음 한 동작을 선택합니다. UI 요소가 없을 때만 최신 이미지의 좌표를 쓰며, `drag`는 시작점과 끝점이 확인된 경우에만 사용합니다.
   현재 `drag` 도구가 `from`/`to` 필드를 제공하면 두 점 이동에는 최신 `look`의 E번호를 우선 사용합니다. 예를 들어 관찰된 소스가 E3이고 대상 타임라인이 E9이면 `{"from":"E3","to":"E9"}`로 지정합니다. 대상에 요소 번호가 없으면 `{"from":"E3","to":"880,540"}`처럼 E번호와 최신 이미지 좌표를 함께 사용할 수 있습니다. 예시 번호·좌표를 그대로 쓰지 말고 실제 관찰 결과로 바꾸세요. 소스 클립이 아닌 빈 여백에서 드래그를 시작하지 않습니다. `points`는 여러 중간 지점이 필요한 경로에만 사용합니다. `from`/`to`가 없는 도구에는 필드를 지어내지 말고 제공된 스키마를 따릅니다.
   API/CEP가 없다는 사실만으로 로컬 작업 불가라고 판단하지 않습니다. 설치된 앱의 화면에서 실제 편집을 시도하세요. 플러그인 코드나 가져오기용 XML만 만든 것은 앱에서 작업을 완료한 것이 아닙니다. 확장 서명 검사·보안 설정을 끄는 방식으로 실행 경로를 만들지 않습니다.
5. 한 번 변경한 뒤 `look`으로 실제 결과를 확인하세요. 타임라인 확대·스크롤·패널 전환 후에는 이전 좌표를 쓰지 않습니다. 변화가 없으면 원인을 확인하고 다른 로컬 경로를 시도합니다. 같은 클릭을 반복해 완료로 처리하지 않습니다.
   이름·경로처럼 기존 값 전체를 바꾸는 입력칸은 먼저 클릭한 뒤 `type`에 `replace:true`를 지정하세요. 이 옵션 없이 `type`만 쓰면 현재 커서에 삽입하므로 기존 이름 가운데 새 이름이 들어갈 수 있습니다. 변경 뒤 필드 전체 값이 요청과 정확히 같은지 확인하세요. Windows 파일/폴더 선택 대화상자에는 `C:\Users\...` 형태의 역슬래시 경로를 사용합니다. 코드나 문서에서 받은 `C:/Users/...` 경로는 폴더 선택 칸에 그대로 붙이지 말고 Windows 경로로 바꿉니다. '폴더 이름이 올바르지 않습니다'가 나오면 실제 폴더 존재 여부와 경로 표기를 구분해 점검하세요.
6. 원본을 유지해야 하는 요청에는 새 프로젝트 사본으로 저장합니다. 다른 열려 있는 사용자 문서에 작업하지 마세요. 렌더·내보내기 파일만 만든 것으로 편집 가능한 프로젝트를 저장했다고 보고하지 않습니다.
7. 저장된 원본을 다시 열어 객체/레이어/트랙과 요청한 치수·길이·텍스트를 확인합니다. 내보내기도 요청되었으면 별도 파일을 열어 재생·시각 검증합니다. 앱 오류, 누락된 소스, 미저장 상태가 있으면 미완료입니다.
   검증은 실제 저장된 결과에서 읽은 값이어야 합니다. 템플릿에 작성한 예정 길이·좌표나 스크립트가 출력한 예상값을 결과 증거로 쓰지 마세요. 가능하면 저장 전후의 실제 객체 상태와 파일 검사를 함께 남깁니다.

## 로컬 경로가 막힌 경우

실행한 로컬 경로, 관찰된 오류, 아직 필요한 결과를 기록합니다. 외부 AI는 실제 실패 또는 지원 불가 증거가 있을 때만 보조자로 사용합니다. 외부 AI의 설명은 실행 성공 증거가 아닙니다. 도움을 받은 뒤에도 로컬 실행과 위 검증을 다시 수행하세요. 인증·라이선스·필수 자료가 없는 경우에는 필요한 사용자 행동을 구체적으로 알립니다.

## 앱별 주요 확인

- Premiere: [references/premiere.md](<스킬폴더>/references/premiere.md)를 읽으세요. 시퀀스, 해상도, 프레임레이트, 트랙, 컷 지점, 오디오 동기. 사용자가 요청하지 않은 속도·게인·효과는 변경하지 않습니다.
- Photoshop/Illustrator: 캔버스/아트보드, 선택 레이어/객체, 마스크, 텍스트 편집 가능 상태.
- After Effects: 활성 컴포지션, 시간 범위, 레이어, 키프레임, 미디어 연결.
- Blender: [references/blender.md](<스킬폴더>/references/blender.md)를 읽으세요. 단위·축척·치수, 객체·메시·재질, 편집 가능한 저장 형식.
- CAD: 단위·축척·치수, Body·스케치·구속 조건, 재계산 오류, 편집 가능한 저장 형식. 아래에서 해당 앱 문서를 읽으세요.

## CAD·3D 앱: 코드가 먼저, 화면은 마지막
치수로 정해지는 작업은 **화면 클릭보다 코드가 훨씬 정확**합니다. 앱 문서의 "코드로" 경로를 먼저 시도하고, 그 경로가 설치 버전에서 안 될 때만 화면을 조작합니다. 화면 조작에서도 끌기 대신 명령창·입력칸에 숫자를 넣습니다.
**스크립트 어댑터가 있는 앱(Blender·FreeCAD)은 `app_script` 도구가 1순위**입니다. 그 도구의 사용법·도우미 목록은 `app-adapters/<앱>.md`에 한 곳으로 모아 두었고 도구를 쓸 때 자동으로 보입니다. 아래 앱 문서는 그 밖의 경로와 일반 요령입니다.

| 앱 | 문서 | 코드 경로 요약 | 주의 |
|---|---|---|---|
| 2D 도면(앱 없이) | [dxf.md](<스킬폴더>/references/dxf.md) | Python ezdxf로 DXF 생성·검사 | 단위(doc.units) 지정, 치수는 render() |
| AutoCAD·LT·호환 CAD | [autocad.md](<스킬폴더>/references/autocad.md) | accoreconsole + SCR, COM(pywin32), AutoLISP | 좌표는 VARIANT 배열, `/l en-US`, LT 제약 |
| Blender | [blender.md](<스킬폴더>/references/blender.md) | `app_script`(app="blender"), 그 밖엔 `blender --background` | 단위 m, 저장은 도구가 함 |
| FreeCAD | [freecad.md](<스킬폴더>/references/freecad.md) | `app_script`(app="freecad"), 그 밖엔 FreeCADCmd | 단위 mm, recompute·isValid 검증 |
| SolidWorks | [solidworks.md](<스킬폴더>/references/solidworks.md) | COM(pywin32), 매크로 녹화로 API 배우기 | 단위 미터 |
| Inventor | [inventor.md](<스킬폴더>/references/inventor.md) | COM(pywin32), iLogic | 단위 cm |
| Fusion | [fusion.md](<스킬폴더>/references/fusion.md) | 앱 안에서만 스크립트 실행(Shift+S) | 외부·헤드리스 실행 불가, 단위 cm |
| Rhino | [rhino.md](<스킬폴더>/references/rhino.md) | `/runscript` + `-RunPythonScript (경로)` | `#! python 3`, 경로 괄호 |
| SketchUp | [sketchup.md](<스킬폴더>/references/sketchup.md) | `-RubyStartup`, Ruby 콘솔 | 단위 인치(.mm 붙이기), 창 항상 뜸 |
| Revit | [revit.md](<스킬폴더>/references/revit.md) | pyRevit CLI, Revit Batch Processor | Transaction, 단위 피트 |
| KiCad | [kicad.md](<스킬폴더>/references/kicad.md) | kicad-cli(내보내기·DRC) | 옵션은 `-h`로 확인 |

앱마다 **API 내부 단위가 다릅니다**(Blender m, SolidWorks m, Inventor·Fusion cm, SketchUp inch, Revit ft, FreeCAD·DXF mm). 숫자를 넣기 전에 반드시 변환하고, 결과 치수를 저장 파일에서 다시 읽어 확인합니다.
문서의 명령·경로는 커뮤니티·공식 문서에서 모은 것입니다. 설치된 버전에서 `-h`·`--version`·파일 존재를 먼저 확인하고, 처음 쓰는 경로는 작은 시험으로 검증한 뒤 본 작업을 합니다.

앱별 문서 링크와 실행 조건은 `discover_tools`의 `creativeApps.routes`에서 확인합니다. 경로의 available은 실행 파일 및 기본 실행 경로 확인이며 실제 프로젝트 작업 성공을 뜻하지 않습니다.
