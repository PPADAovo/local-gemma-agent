# Autodesk Fusion (Fusion 360)

## 중요한 제약
- **Fusion 밖에서 API를 부를 수 없습니다**(Autodesk 직원의 공식 답변: out-of-process API 미지원). VS Code·명령줄에서 .py를 직접 실행해도 모델을 못 만집니다. **헤드리스 실행도 없음.**
- 그래서 코드로 하려면: 스크립트 파일을 만든 뒤 **Fusion 안에서** 실행해야 합니다(화면 조작 한 번 필요).

## 코드로 (Fusion 안에서 실행)
1. 스크립트 폴더: `%APPDATA%\Autodesk\Autodesk Fusion 360\API\Scripts\<이름>\<이름>.py` (설치 버전에 따라 경로 확인).
2. 내용:
```python
import adsk.core, adsk.fusion
def run(context):
    app = adsk.core.Application.get()
    design = adsk.fusion.Design.cast(app.activeProduct)
    root = design.rootComponent
    sk = root.sketches.add(root.xYConstructionPlane)
    sk.sketchCurves.sketchLines.addTwoPointRectangle(adsk.core.Point3D.create(0, 0, 0), adsk.core.Point3D.create(10, 6, 0))
    prof = sk.profiles.item(0)
    ext = root.features.extrudeFeatures.addSimple(prof, adsk.core.ValueInput.createByReal(1.0),
                                                  adsk.fusion.FeatureOperations.NewBodyFeatureOperation)
```
3. Fusion에서 **Shift+S**(유틸리티 → 추가 기능 → 스크립트 및 추가 기능) → 스크립트 선택 → 실행.
- **API 내부 단위는 cm**(100mm = 10). 문자열로 넣으면 단위 지정 가능: `ValueInput.createByString("100 mm")`.
- 커뮤니티 우회법: 시작 시 켜지는 추가 기능(add-in)이 로컬 소켓으로 명령을 받게 하는 방법이 있으나 공식 기능 아님. 만들지 말고 필요하면 사용자와 상의.

## 대안(커뮤니티 추천)
- 헤드리스가 꼭 필요하면 FreeCAD(Python)로 만들어 STEP으로 내보낸 뒤 Fusion에서 여는 방법.

## 화면 조작 기본
- S: 도구 검색, E: 돌출, D: 치수, L: 선, R: 사각형, C: 원. 값은 입력칸에 숫자.
- 타임라인(아래)에 작업 기록이 남음. 클라우드 저장이라 저장 시 이름·위치 대화상자 확인.

출처: [포럼: 헤드리스 실행 불가](https://forums.autodesk.com/t5/fusion-api-and-scripts/is-there-a-way-to-run-scripts-plugins-in-f360-headless/td-p/9962552), [포럼: 외부에서 연결](https://forums.autodesk.com/t5/fusion-api-and-scripts/interface-with-fusion-from-outside-the-application/td-p/12068685), [포럼: 터미널에서 실행](https://forums.autodesk.com/t5/fusion-api-and-scripts/run-fusion-script-from-terminal-command-prompt/td-p/10285701), [Python 관련 주의](https://help.autodesk.com/cloudhelp/ENU/Fusion-360-API/files/PythonSpecific_UM.htm), [FusionMCP 시연 기사](https://www.fabbaloo.com/news/natural-language-mechanical-design-fusionmcp-demonstrates-ai-driven-cad)
