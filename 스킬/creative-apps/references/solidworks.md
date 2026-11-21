# SolidWorks

공식 API는 VBA·VB.NET·C#·C++용이지만 COM이라 **Python(pywin32)으로도 조작**할 수 있습니다. 창 없이 백그라운드로 띄우는 것도 공식 예제가 있습니다.

## 가장 쉬운 학습법 — 매크로 녹화
- 도구(Tools) → 매크로(Macro) → 기록(Record)으로 사람이 한 조작을 VBA로 녹화하면 **정확한 API 호출과 매개변수**를 얻을 수 있습니다. 이걸 보고 Python으로 옮기는 것이 추측보다 훨씬 정확합니다.
- 실행: 도구 → 매크로 → 실행(Run)으로 .swp 실행.

## Python(pywin32)
```python
import win32com.client, pythoncom
sw = win32com.client.Dispatch("SldWorks.Application")
sw.Visible = True                 # 안 하면 숨겨진 채로 실행됨
model = sw.ActiveDoc              # 열린 문서, 없으면 None
# 파일 열기: OpenDoc6(경로, 문서종류(1=부품,2=조립,3=도면), 옵션, "", errors, warnings) — ByRef 인자 주의
```
- **단위는 미터**(API 입력·출력). 100mm = 0.1.
- `SelectByID2` 같은 함수의 선택적 객체 인자(Callout)는 `win32com.client.VARIANT(pythoncom.VT_DISPATCH, None)`로 넘겨야 동작했다는 사례.
- `GetMathUtility`처럼 **메서드인데 속성처럼 부르면** 이상한 오류(makepy 바인딩 관련) → 괄호를 붙여 호출.
- 상수 이름(swDocPART 등)을 쓰려면 makepy로 형식 라이브러리를 만들어야 함. 아니면 숫자 값을 문서에서 확인해 씀.
- ByRef [out] 인자는 Python에서 잘 안 됨 → 그런 함수는 녹화된 VBA 매크로를 실행하는 편이 안정적.
- 래퍼 라이브러리: pySldWrap, PySWX(2024 API 기반) — 설치돼 있을 때만.

## 화면 조작 기본
- 스케치: 평면 선택 → 스케치 → 도형 → **치수(Smart Dimension)로 값 입력**. 끌어서 크기 맞추지 말 것.
- 피처: 돌출(Extruded Boss) → 깊이 입력 → 확인(초록 체크).
- 피처 트리(왼쪽)에서 오류(빨간 표시) 확인. Ctrl+S 저장, Ctrl+Q 재생성.

## 검증
- 저장 후 다시 열어 질량 특성(MassProperty)·바운딩 박스·피처 오류 여부를 API로 읽음.

출처: [SOLIDWORKS Visible or Background 예제](https://help.solidworks.com/2019/english/api/sldworksapi/SOLIDWORKS_Visible_or_BackGround_Example_VB.htm), [python-win32: SolidWorks 이상한 오류](https://www.python.org/pipermail/python-win32/2020-October/014417.html), [makepy·SelectByID2 사례](https://joshuaredstone.blogspot.com/2015/02/), [PySWX](https://pypi.org/project/pyswx/), [pySldWrap](https://pypi.org/project/pySldWrap)
