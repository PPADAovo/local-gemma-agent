---
name: reminders
description: 미리알림·할 일 관리 (Apple 미리알림 대신, 이 PC의 예약 알림과 할 일 목록 파일)
---
# 미리알림 / 할 일 (Windows용)

Apple 메모·미리알림은 Mac 전용이라, 같은 기능을 이렇게 처리합니다.

- 몇 분 뒤에 알려주기: schedule_add text="<할 일> 알람" target="in 10" (10분 뒤. 현재 시각을 계산하지 않는다) → 그 시간에 Windows 알림이 한 번 뜬다
- 특정 시각에 알려주기: schedule_add text="<할 일> 알람" target="once 15:00" 또는 "once 2026-11-11 15:00"
- 반복 알림: target="daily 08:00" / "weekly mon 09:00"
- 알람은 한 번 등록하면 끝이다. 같은 알람을 다시 만들거나 run으로 알림 창(MessageBox)을 띄우지 않는다.
- 할 일 목록: 작업공간\할일.md 파일 사용
  - 추가: read로 확인 후 edit 또는 write로 `- [ ] 할 일 (마감: 날짜)` 줄 추가
  - 완료: `- [ ]` → `- [x]` 로 edit
  - 보기: read path=할일.md
- 메모: note 도구(날짜별 노트)
