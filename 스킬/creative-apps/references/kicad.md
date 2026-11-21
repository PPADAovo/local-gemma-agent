# KiCad (회로·PCB)

## 코드로 — kicad-cli (KiCad 7 이상, 화면 없이)
- 위치: `C:\Program Files\KiCad\<버전>\bin\kicad-cli.exe`.
- **모르는 옵션은 추측하지 말고 `-h`로 확인**: `kicad-cli pcb export gerbers -h` (어느 단계에서나 -h 가능, 버전마다 옵션이 다름).
- 자주 쓰는 것:
  - 거버: `kicad-cli pcb export gerbers -o out\ 보드.kicad_pcb` (복수형 `gerbers`)
  - 드릴: `kicad-cli pcb export drill -o out\ 보드.kicad_pcb`
  - PCB PDF: `kicad-cli pcb export pdf ...`, 회로도 PDF: `kicad-cli sch export pdf 회로.kicad_sch`
  - 검사: `kicad-cli pcb drc`, `kicad-cli sch erc` (버전 확인 후)
- 보드 편집 자체는 pcbnew Python 스크립팅 콘솔(KiCad 안)에서. 버전별 API 차이가 커서 설치 버전 문서를 확인.

## 화면 조작 기본
- 회로도(Eeschema): A 부품 추가, W 배선, Ctrl+S. PCB: X 배선, B 존 채우기, 3D 보기 Alt+3.
- 제조 출력: 파일 → 제조 출력 → Gerbers.

## 검증
- DRC/ERC 결과 0 오류, 출력 폴더의 파일 목록(각 레이어 .gbr, .drl) 확인.

출처: [KiCad 9 CLI 매뉴얼](https://docs.kicad.org/9.0/en/cli/cli.html), [KiCad 10 CLI](https://docs.kicad.org/10.0/en/cli/cli.pdf), [JLCPCB: KiCad 9 거버·드릴](https://jlcpcb.com/help/article/how-to-generate-gerber-and-drill-files-in-kicad-9)
