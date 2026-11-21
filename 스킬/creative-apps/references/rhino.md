# Rhino (Rhino 7/8, Grasshopper)

## 코드로
- Rhino 8: 스크립트 편집기(`ScriptEditor`)에서 Python 3. 명령줄에서 파일 실행은 `-RunPythonScript` + **파일 경로**(코드 문자열이 아님).
- Rhino를 띄우면서 스크립트 실행(Windows):
  `"C:\Program Files\Rhino 8\System\Rhino.exe" /nosplash /runscript="_-RunPythonScript (C:\경로 공백 포함\make.py)"`
  - **경로를 괄호로 감싸야** 공백 있는 경로가 둘로 쪼개지지 않음(포럼).
- 스크립트 맨 위에 `#! python 3` 를 넣어야 명령줄·버튼에서 실행되는 사례(스크립트 편집기에서는 되는데 명령줄에서 안 될 때).
- 다른 명령 실행 중에는 `RunPythonScript`가 취소될 수 있음 → 단독으로 실행.
```python
#! python 3
import rhinoscriptsyntax as rs
rs.AddLine((0, 0, 0), (100, 0, 0))
rs.AddBox([(0,0,0),(100,0,0),(100,60,0),(0,60,0),(0,0,10),(100,0,10),(100,60,10),(0,60,10)])
rs.Command('_-SaveAs "C:\\경로\\결과.3dm" _Enter', echo=False)
```
- Rhino 없이 .3dm 읽기·쓰기: `rhino3dm` 파이썬 라이브러리(형상 계산 기능은 제한).
- 단위는 문서 단위(보통 mm) — `rs.UnitSystem()`으로 확인.

## 화면 조작 기본
- 모든 기능은 명령줄 입력(예: `Line` Enter → 좌표 `0,0,0` Enter `100,0,0` Enter). 앞에 `-`를 붙이면 대화상자 없는 버전.
- Esc 취소, Enter/Space 반복. Ctrl+S 저장.

## 검증
- `rs.BoundingBox`, `rs.SurfaceVolume`, 객체 수를 저장 후 다시 열어 확인.

출처: [Running a Python script in Rhino](https://developer.rhino3d.com/guides/rhinopython/python-running-scripts/), [포럼: 공백 경로 + .bat 실행](https://discourse.mcneel.com/t/launching-rhino-from-bat-and-running-command-with-space-in-path/177242), [포럼: 명령줄에서 스크립트가 안 될 때](https://discourse.mcneel.com/t/script-wont-run-from-command-line-or-button/218768), [포럼: RunScript vs RunPythonScript](https://discourse.mcneel.com/t/runscript-vs-runpythonscript-inside-commands-problem/93871)
