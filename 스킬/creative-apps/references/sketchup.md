# SketchUp

## 코드로 (Ruby)
- 실행 시 스크립트: `SketchUp.exe -RubyStartup "C:\경로\make.rb"` (커뮤니티에서 쓰는 방법, 공식 문서는 못 찾음).
  - **창 없는 모드는 없음** — 항상 화면이 뜸. 실행된 스크립트는 부른 쪽과 따로 돌아 결과를 돌려주지 않음 → 스크립트가 직접 파일로 저장하고 로그를 파일로 남기게 함.
  - 창이 포커스를 받아야 스크립트가 실행되는 사례(맥) → 실행 후 `look`으로 확인.
  - 매개변수는 명령줄로 넘기기 어려움 → 값을 스크립트에 넣거나 환경 변수 사용.
- 실행 중인 SketchUp: 확장(Extensions) → 개발자 → Ruby 콘솔에 `load "C:/경로/make.rb"`.
```ruby
model = Sketchup.active_model
ents = model.active_entities
# 내부 단위는 인치! mm는 .mm 메서드로 변환
face = ents.add_face([0, 0, 0], [100.mm, 0, 0], [100.mm, 60.mm, 0], [0, 60.mm, 0])
face.reverse! if face.normal.z < 0
face.pushpull(10.mm)
model.save("C:/경로/결과.skp")
```
- **내부 단위는 인치** — 숫자를 그냥 쓰면 인치로 들어감. 항상 `.mm`/`.cm`/`.m` 붙이기.

## 화면 조작 기본
- 단축키: 선 L, 사각형 R, 밀고당기기 P, 이동 M, 줄자 T, 회전 Q. 도형을 그린 뒤 **바로 숫자를 치고 Enter**(VCB 입력란)로 정확한 길이 입력.
- 그룹/컴포넌트로 묶지 않으면 맞닿은 면이 서로 붙어 버림.

출처: [SketchUcation: RubyStartup](https://community.sketchucation.com/topic/121859/sketchup-command-line-rubystartup), [SketchUp 포럼: 창 포커스 전엔 실행 안 됨](https://forums.sketchup.com/t/run-sketchup-with-command-arguments-rubystartup-but-it-not-executed-util-window-focused/301884), [명령줄 실행 문제](https://community.sketchucation.com/topic/129497/problem-when-running-ruby-script-from-command-line/11)
