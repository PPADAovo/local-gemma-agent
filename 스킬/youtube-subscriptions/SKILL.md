---
name: youtube-subscriptions
description: 사용자가 유튜브에서 구독 중인 채널 목록을 보거나 파일로 정리해 달라는 요청에 사용한다.
---
# 유튜브 구독 채널 목록

순서:
1. browser_open text=https://www.youtube.com/feed/channels (검색하지 말고 이 주소를 바로 연다). 이미 로그인된 창이 있으면 그 창을 쓴다.
2. 로그인 화면이 나오면 user_action text="작업 창에서 YouTube에 직접 로그인해 주세요"로 요청하고 기다린다. 비밀번호는 묻지 않는다.
3. browser_read로 보이는 채널 이름을 모은다 → browser_scroll text=down → browser_read 를 반복한다. 새 이름이 더 나오지 않으면 끝이다.
4. 이름이 겹치면 한 번만 남기고 개수를 센다.
5. 파일로 달라고 하면 make_xlsx(열: 채널 이름) 또는 write로 .csv를 만든다.

규칙:
- 화면 캡처(look)로 읽지 않는다. browser_* 도구로 글자를 읽는다.
- 끝까지 내려갔는지 확인하지 못했으면 "일부만 확인"이라고 적는다.
- 구독 취소, 알림 설정 변경은 사용자가 분명히 요청했을 때만 하고 채널마다 확인받는다.
