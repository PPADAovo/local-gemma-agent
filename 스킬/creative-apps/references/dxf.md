# DXF 2D 도면 — CAD 프로그램 없이 코드로 (ezdxf)

평면도·부품 외곽·레이저 컷 도면처럼 **숫자로 정할 수 있는 2D 도면**은 CAD를 화면으로 조작하지 말고 Python `ezdxf`로 만듭니다. 결과 DXF는 AutoCAD·FreeCAD·LibreCAD·ZWCAD 등 대부분의 CAD에서 열립니다. 이 PC에서 실제로 실행해 확인한 경로입니다(ezdxf 1.4).

## 준비
- `run`: `python -c "import ezdxf; print(ezdxf.__version__)"` — 없으면 `pip install ezdxf`(설치는 사용자 승인 후).
- 스크립트는 작업 폴더에 .py로 쓰고 `python -I 파일.py`로 실행(셸 명령 안에 코드를 길게 끼워 넣지 않음).

## 만들기
```python
import ezdxf
from ezdxf import units
doc = ezdxf.new("R2018", setup=True)   # setup=True: 기본 선 종류·글꼴·치수 스타일(EZDXF) 준비
doc.units = units.MM                    # 단위를 반드시 지정(안 하면 열 때 크기가 달라짐)
doc.layers.add("외곽", color=7)
doc.layers.add("치수", color=1)
msp = doc.modelspace()
msp.add_lwpolyline([(0, 0), (100, 0), (100, 60), (0, 60)], close=True, dxfattribs={"layer": "외곽"})
msp.add_circle((50, 30), 15, dxfattribs={"layer": "외곽"})
dim = msp.add_linear_dim(base=(0, -15), p1=(0, 0), p2=(100, 0), dimstyle="EZDXF", dxfattribs={"layer": "치수"})
dim.render()                            # 치수는 render()를 해야 화면에 그려짐
doc.saveas(r"C:\경로\plate.dxf")
```
- 그 밖에: `add_line`, `add_arc(center, radius, start_angle, end_angle)`, `add_text("글", dxfattribs={"height": 5}).set_placement((x, y))`, `add_aligned_dim`, `add_radius_dim`.
- 원본 DXF를 고칠 때는 `ezdxf.readfile(경로)`로 열고 **새 이름으로** `saveas`.

## 검증 (만든 값이 아니라 저장된 파일에서 읽기)
```python
import sys, ezdxf
from ezdxf import bbox
doc = ezdxf.readfile(sys.argv[1])
auditor = doc.audit()                   # 파일 구조 오류 검사
msp = doc.modelspace()
print("errors", len(auditor.errors), "units", doc.units)
print("entities", [e.dxftype() for e in msp])
ext = bbox.extents(msp)                 # 실제 도면 범위 = 전체 크기 확인
print("extents", ext.extmin, ext.extmax)
```
- 실제 결과 예: `errors 0 units 4(mm) entities ['LWPOLYLINE','CIRCLE','DIMENSION'] extents (-0.1,-15.4)~(100.1,60.0)` → 요청한 100×60과 맞는지 비교.
- 모양을 눈으로 보려면 `matplotlib`이 있을 때 `ezdxf.addons.drawing`으로 PNG를 만들 수 있습니다(없으면 숫자 검증만).

## DWG가 필요할 때
- ezdxf는 DWG를 직접 쓰지 못합니다. AutoCAD가 있으면 Core Console로 `DXFIN` 후 `_.SAVEAS`(autocad.md), 없으면 사용자에게 DXF로 전달하고 "CAD에서 열어 DWG로 저장"을 안내합니다.

출처: [ezdxf 문서](https://ezdxf.readthedocs.io/)
