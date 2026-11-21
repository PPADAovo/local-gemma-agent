# AutoCAD (AutoCAD · AutoCAD LT · ZWCAD·GstarCAD 같은 호환 CAD)

## 고르는 순서
1. **새 2D 도면**이면 AutoCAD 없이 `dxf.md`(ezdxf)로 만들고, 필요하면 AutoCAD로 열어 DWG로 저장합니다. 가장 확실합니다.
2. **기존 DWG 일괄 처리**(정리·변환·PDF 출력·레이어 변경)는 Core Console(`accoreconsole.exe`) + SCR 스크립트.
3. **열려 있는 도면을 직접 고칠 때**만 COM(파이썬 pywin32) 또는 AutoLISP.
4. 위가 안 되면 화면 조작(명령창에 입력).

## 1) Core Console — 화면 없이 DWG 처리 (정식 AutoCAD만)
- 위치: `C:\Program Files\Autodesk\AutoCAD <버전>\accoreconsole.exe`. **AutoCAD LT에는 없을 수 있으니** `discover_tools` 결과와 파일 존재를 먼저 확인.
- 형식(공식 도움말): `accoreconsole.exe /i "입력.dwg" /s "작업.scr" /l en-US`
  - `/l en-US`가 없으면 실행이 안 되는 사례가 포럼에 여러 번 나옴 → 항상 붙입니다.
  - 경로에 공백이 있으면 큰따옴표. 폴더 일괄은 PowerShell `Get-ChildItem *.dwg | ForEach-Object { & $acc /i $_.FullName /s 작업.scr /l en-US }`.
- SCR 스크립트 규칙:
  - 한 줄 = 명령창에 친 것과 같음. **빈 줄 = Enter**, 공백도 Enter로 취급되므로 줄 끝 공백 주의.
  - 명령은 `_.` 접두사(`_.LINE`, `_.QSAVE`)로 써서 언어판·재정의 명령 영향을 피합니다.
  - 파일 대화상자가 뜨지 않게 맨 앞에 `FILEDIA` `0`, 끝에 원래대로.
  - 저장: `_.SAVEAS` `2018` `"C:\경로\결과.dwg"` (새 파일로 저장해 원본 보존).
- 알려진 문제(포럼): 배치 파일에서 `-PLOT`/PUBLISH가 수동 실행과 다르게 플로터(.pc3) 이름을 못 읽거나 접근 위반으로 죽는 사례 → PDF 출력은 한 파일로 먼저 시험.
- 참고 도구: [acadbp](https://github.com/k-awata/acadbp)(accoreconsole 일괄 처리 래퍼).

## 2) COM — 실행 중인 AutoCAD를 파이썬으로 (pywin32)
```python
import win32com.client, pythoncom
acad = win32com.client.Dispatch("AutoCAD.Application")   # 실행 중이면 붙고, 아니면 띄움
doc = acad.ActiveDocument
ms = doc.ModelSpace
def P(x, y, z=0.0):   # 좌표는 반드시 double 배열 VARIANT로 (리스트·튜플 그대로 넘기면 형식 오류)
    return win32com.client.VARIANT(pythoncom.VT_ARRAY | pythoncom.VT_R8, (x, y, z))
ms.AddLine(P(0, 0), P(100, 0))
ms.AddCircle(P(50, 30), 15)
doc.SaveAs(r"C:\경로\결과.dwg")
```
- 좌표를 VARIANT로 감싸지 않아 생기는 오류가 커뮤니티에서 가장 흔한 문제(python-win32 메일링 리스트).
- `gencache.EnsureDispatch`가 만든 캐시가 꼬이면 gen_py 캐시 폴더를 지우고 `Dispatch`로.
- AutoCAD가 명령 실행 중(사용자 입력 대기)이면 COM 호출이 "호출이 거부됨"으로 실패 → Esc로 명령을 끝낸 뒤 재시도.

## 3) AutoLISP
- `APPLOAD`로 .lsp를 불러오거나 명령창에 `(load "C:/경로/x.lsp")`(경로는 `/` 또는 `\\`).
- 예: `(command "_.LINE" '(0 0) '(100 0) "")`
- AutoCAD LT는 **2024부터** AutoLISP 지원. 그 이전 LT는 SCR만.
- 신뢰 경로(TRUSTEDPATHS)·SECURELOAD를 임의로 낮추지 않습니다. 경고가 뜨면 사용자에게 알립니다.

## 화면 조작 기본 (최후 수단)
- 모든 기능은 **명령창 입력**이 가장 확실: 명령 이름 입력 → Enter → 프롬프트에 좌표·값 입력. 클릭으로 점을 찍지 말고 `100,50` 같은 좌표를 입력.
- Esc: 명령 취소(두 번 누르면 확실). Enter/Space: 직전 명령 반복·확정.
- `Z` Enter `E` Enter: 전체 보기(Zoom Extents). F8 직교, F3 객체 스냅, F12 동적 입력.
- 단위·축척 확인: `UNITS`, 치수 스타일 `DIMSTYLE`. 모델/배치(Layout) 공간 구분.

## 검증
- 저장한 DWG를 다시 열어(또는 Core Console 스크립트로) 객체 수·레이어·치수 값을 읽습니다.
- DXF로 저장했다면 `dxf.md`의 검사 스크립트로 확인할 수 있습니다.

출처: [AutoCAD Core Console 도움말](https://help.autodesk.com/cloudhelp/2026/ENU/AutoCAD-Core-Console/files/AUTOCAD_CORE_CONSOLE.html), [Getting started with AccoreConsole](https://blog.autodesk.io/getting-started-with-accoreconsole/), [포럼: accoreconsole batch](https://forums.autodesk.com/t5/visual-lisp-autolisp-and-general/accoreconsole-batch/td-p/8487768), [python-win32: AddLine VARIANT](https://mail.python.org/pipermail/python-win32/2012-February/012006.html)
