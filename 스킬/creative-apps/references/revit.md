# Revit (BIM)

## 코드로
- Revit API는 Revit 안에서만 동작(로컬 헤드리스 없음). 방법은 셋:
  1. **pyRevit CLI**: `pyrevit run <스크립트.py> <모델.rvt> --revit=<연도>` — 모델 버전에 맞는 Revit을 골라 스크립트를 실행. pyRevit이 해당 Revit 버전에 연결돼 있어야 함.
  2. **Revit Batch Processor(RBP)**: 무료 오픈소스, 여러 RVT에 Python/Dynamo 작업 일괄 실행. 저장·동기화는 스크립트가 직접 해야 함.
  3. 클라우드 Design Automation API(진짜 헤드리스, 별도 패키징·계정 필요) — 사용자와 상의 없이 쓰지 않음.
- API 규칙: 모델을 바꾸는 코드는 반드시 `Transaction` 안에서. **내부 길이 단위는 피트**(1 ft = 304.8 mm) — `UnitUtils.ConvertToInternalUnits`로 변환.
- 실행 중 Revit에서 대화형: pyRevit 버튼, RevitPythonShell, Dynamo.

## 화면 조작 기본
- 벽 WA, 문 DR, 창 WN, 치수 DI, 3D 뷰 기본 단축키. 속성 창(Properties)에 숫자 입력.
- 중앙 모델(워크셰어링)은 동기화 전 저장 위치·권한 확인. 사용자의 중앙 모델에 직접 쓰지 않음.

출처: [pyRevit 일괄 처리](https://pyrevitlabs.notion.site/Batch-Process-Revit-Models-d2c336a656684e2ebbc12371b70ac109), [Revit Batch Processor](https://github.com/bvn-architecture/RevitBatchProcessor), [RBP 소개(Autodesk 블로그)](https://blog.autodesk.io/the-revit-batch-processor-rbp/)
