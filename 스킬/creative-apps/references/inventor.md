# Autodesk Inventor

COM API라 **Python(pywin32)**으로 조작할 수 있고, 커뮤니티에서는 "Fusion과 API가 비슷하면서 헤드리스로 돌릴 수 있는 쪽"으로 추천됩니다.

## Python(pywin32)
```python
import win32com.client
inv = win32com.client.Dispatch("Inventor.Application")   # 또는 GetActiveObject로 실행 중인 것에 붙기
inv.Visible = True
uom = inv.UnitsOfMeasure                                   # 단위 변환 도우미
```
- **내부 단위는 센티미터**(길이), 라디안(각도), kg(질량). 문서 표시 단위를 mm로 바꿔도 **API는 항상 cm** → 100mm는 10.0으로 넘김.
- 단위 변환은 `UnitsOfMeasure`(예: "in"↔"cm").
- 커뮤니티 경고: `EnsureDispatch`가 만든 gen_py 캐시 때문에 `GetActiveObject`가 깨질 수 있음 → 문제 시 gen_py 캐시 삭제.
- iLogic(규칙)·VBA 매크로도 있음. 사람이 만든 iLogic 규칙이 있으면 그것을 실행하는 것이 가장 안전.

## 화면 조작 기본
- 스케치 → 치수 입력 → 돌출(E). 모든 크기는 치수 대화상자에 숫자로.
- 모델 브라우저(왼쪽)에서 오류 표시 확인, Ctrl+S 저장.

## 검증
- 다시 열어 `ComponentDefinition.MassProperties`, `RangeBox`(cm)로 크기 확인.

출처: [Inventor API 단위 개요(UOM)](https://help.autodesk.com/cloudhelp/2021/ENU/Inventor-API/files/UOM_Overview.htm), [UnitsOfMeasure](https://help.autodesk.com/cloudhelp/2025/ENU/Inventor-API/files/UnitsOfMeasure.htm), [inventor-mcp(gen_py 경고)](https://github.com/NeonGlay/inventor-mcp), [Getting Started with Inventor API](https://help.autodesk.com/cloudhelp/2018/ENU/Inventor-API/files/GettingStarted.htm)
