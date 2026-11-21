# FreeCAD (무료 3D 파라메트릭 CAD)

AI·코드 연동 도구가 가장 많은 CAD입니다. **화면 없이 Python으로 전부 할 수 있어** 화면 조작보다 코드가 우선입니다.

## 1순위: `app_script` 도구 (app="freecad")
- 이 앱에는 스크립트 어댑터가 있습니다. 사용법(미리 있는 이름 `App`·`Part`·`doc`·`Vector`, 단위 mm, 결과로 오는 크기·부피·유효성)은 그 도구를 쓸 때 자동으로 보이는 `app-adapters/freecad.md`가 기준입니다.
- 이 경로에서는 **저장·내보내기·파일 열기를 도구가 대신 합니다.** 코드에 `doc.saveAs`·`Part.export`를 넣으면 막힙니다.

## 2순위: FreeCADCmd 직접 실행 (어댑터로 안 되는 일만 — 예: STEP 내보내기, 기존 FCStd 수정)
- 실행 파일: 설치 폴더 `bin\FreeCADCmd.exe`(1.0 이후 `freecadcmd.exe`일 수 있음). `discover_tools`나 `find_file`로 실제 이름 확인.
- 형식(공식 위키 Headless FreeCAD): `FreeCADCmd "C:\경로\make.py"` — 복잡한 작업은 이 방식이 권장됨.
```python
import FreeCAD as App, Part
doc = App.newDocument("부품")
box = doc.addObject("Part::Box", "Box")
box.Length, box.Width, box.Height = 100, 60, 10       # 단위 mm
hole = doc.addObject("Part::Cylinder", "Hole")
hole.Radius, hole.Height = 15, 10
hole.Placement.Base = App.Vector(50, 30, 0)
cut = doc.addObject("Part::Cut", "Plate")
cut.Base, cut.Tool = box, hole
doc.recompute()                                         # 반드시 재계산
doc.saveAs(r"C:\경로\plate.FCStd")
Part.export([cut], r"C:\경로\plate.step")              # STEP 내보내기
```
- 커뮤니티 팁: GUI의 내보내기와 같은 결과가 필요하면 `import Import; Import.export([obj], "x.step")`를 쓰는 사람도 있음(둘 다 시험해 보고 고름).
- 스케치·구속 조건이 필요한 파라메트릭 모델은 `PartDesign::Body` + `Sketcher::SketchObject` + `PartDesign::Pad`. 구속이 부족하면 재계산 오류 → `obj.isValid()`, `doc.recompute()` 반환값 확인.

## 검증
```python
import FreeCAD as App
doc = App.openDocument(r"C:\경로\plate.FCStd")       # 저장한 파일을 다시 연다
for o in doc.Objects:
    s = getattr(o, "Shape", None)
    if s and not s.isNull():
        print(o.Name, s.isValid(), round(s.Volume, 2), s.BoundBox)
```
- `isValid()`가 False거나 Volume이 0이면 미완성. BoundBox 크기를 요청 치수와 비교.

## 화면 조작 기본
- 작업대(Workbench) 선택이 먼저: 부품은 Part Design, 간단한 형상은 Part, 2D는 Sketcher/Draft.
- 파이썬 콘솔: 보기(View) → 패널 → Python console. 매크로: 매크로(Macro) → 매크로…(실행).
- 마우스 조작 방식(Navigation style)이 여러 개라 화면 드래그는 예측이 어려움 → 숫자 입력·Python 콘솔을 우선.
- 저장 Ctrl+S, 재계산 Ctrl+R(빨간 느낌표 표시는 재계산 필요/오류).

## 커뮤니티 후기
- LLM에 FreeCAD 도구를 연결해 본 개발자 후기: "도구 연결은 일부일 뿐, 더 큰 과제는 **공학적 작업 순서**(스케치 → 구속 → 피처 → 검증)를 가르치는 것" — 한 번에 완성하려 하지 말고 단계마다 검증.
- FreeCAD용 MCP 서버(도구 57개, 도커 헤드리스 실행 등)가 여러 개 있음 — 필요하면 참고.

출처: [Headless FreeCAD (공식 위키)](https://wiki.freecad.org/Headless_FreeCAD), [Part Export](https://wiki.freecad.org/Part_Export/en), [FreeCAD 1.0 STEP 내보내기](https://takuto-na.github.io/step-standards-explained/implementation/freecad-step-export), [LLM으로 FreeCAD 다뤄 본 후기](https://tspi.at/2026/08/06/llmfreecad.html), [CAD용 MCP 서버 정리](https://dev.to/grove_chatforest/cad-3d-modeling-mcp-servers-blender-freecad-autocad-kicad-solidworks-and-more-20ja)
