# Blender (app_script app="blender", Python bpy)

## 실행 방식
- 기본(mode="live"): 사용자가 보는 Blender 창에서 실시간 실행. 장면과 변수가 다음 호출까지 남습니다(IDLE처럼).
  - 수정 요청("더 크게", "접시 옮겨")은 **새로 만들지 말고** `bpy.data.objects["이름"]`으로 찾아 고칩니다(크기 `obj.scale`, 위치 `obj.location`).
  - 도우미(lathe·box·cylinder·sphere·tube_arc)로 같은 이름을 다시 만들면 앱이 이전 물체를 지우고 바꿔 끼웁니다(복사본 안 생김).
  - 저장 파일은 이 창의 문서 하나를 계속 덮어씁니다. 파일 이름에 _v2·_final을 붙이지 마세요.
  - 빼야 할 물체는 `remove_objects("쿠키")`. 완전히 새 작품을 시작할 때만 `clear_scene()`(그때만 새 파일로 저장).
- mode="background": 창 없이 새 장면에서 실행해 파일만 만듭니다.
- 저장·렌더·장면 보고는 도구가 자동으로 합니다. 코드에서 저장·파일 열기·os/subprocess는 막혀 있습니다.

## 미리 불러 둔 범용 도우미 (단위 m)
- `lathe(이름, [(반지름, 높이), ...], thickness)`: 단면을 Z축으로 회전 + 두께 + 부드럽게 → 회전체
- `tube_arc(이름, center, radius, tube_radius, start_deg, end_deg, plane="XZ")`: 원호 관(손잡이·고리·주둥이 곡선)
- `box(이름, size=(가로,세로,높이), location)`, `cylinder(이름, radius, depth, location)`, `sphere(이름, radius, location)`
- `material("glass|ceramic|metal|plastic", (r,g,b,1))`, `assign(물체, 재질)`, `setup_scene(대상)` = 카메라·조명·바닥(다시 불러도 겹치지 않음)
- `remove_objects(*이름앞부분)`, `clear_scene()`, `report()`

## 지켜야 할 것
- 물체 이름에 요청 낱말을 넣으세요(와인잔·접시·쿠키·의자 다리). 앱이 이름으로 요청과 장면을 대조합니다.
- 부품은 서로 닿게 놓습니다(떨어진 부품은 미완료 경고). 원점은 바닥(z=0) 기준.
- 결과의 "실제 장면 물체"와 렌더만 사실입니다. 거기 없는 것을 답에 쓰지 마세요.
- 화면 조작이 꼭 필요하면: 시작 화면은 esc로 닫고, 단축키는 커서가 있는 영역에 적용됩니다(앱이 3D 뷰포트로 옮김).

## 패턴 예시 (그대로 복사하지 말고 치수를 요청에 맞게)
- 잔·컵·병·그릇·꽃병 = 회전체: 바닥 중심(0.001,0) → 바깥 윤곽을 따라 위로.
  와인잔 `lathe("와인잔",[(0.001,0),(0.035,0),(0.034,0.003),(0.006,0.01),(0.0045,0.02),(0.0045,0.08),(0.02,0.09),(0.04,0.13),(0.042,0.17),(0.037,0.2)],thickness=0.0018)`
- 손잡이 달린 컵: 몸통 lathe + `tube_arc("머그 손잡이", center=(몸통반지름,0,높이*0.5), radius=높이*0.28, tube_radius=0.005)`
- 의자·탁자 = 상자/원기둥 조합: 좌판 `box`, 다리 4개 `cylinder`(좌판 아래에 닿게), 등받이 `box`.
- 찻주전자 = 몸통 lathe + 뚜껑 lathe + 꼭지 sphere + 손잡이 tube_arc + 주둥이(원기둥을 기울이거나 tube_arc).
