---
name: notion
description: Notion 페이지를 찾아 읽거나, 새 페이지를 만들고 기존 페이지에 내용을 추가·수정할 때 사용한다 (연결된 Notion 서비스).
---
# Notion (연결된 서비스)

API 토큰 없이 연결된 Notion 서비스로 처리한다.
- 쓰는 법: plugin_search text=`notion <도구이름>` 으로 입력 형식을 확인하고 → plugin_call path=`notion.<도구이름>` text=`{JSON}`.
- plugin_search 는 한 번에 8개까지만 보여 준다. 아래 도구 이름을 그대로 넣어 찾는다.

연결 확인: plugin_call path=`notion.notion-list-recent-pages` text=`{"limit":3}` → 페이지가 나오면 연결된 것이다. 실패하면 설정의 플러그인에서 Notion을 다시 연결해 달라고 알린다.

도구:
- 찾기: `search` {"query":"<짧은 검색어>"} → 페이지 제목·주소
- 최근 페이지: `notion-list-recent-pages` {"limit":10}
- 읽기: `fetch` {"id":"<페이지 주소 또는 ID>"} → 본문(Notion 마크다운)
- 새 페이지: `notion-create-pages`
  - 위치를 말했으면 {"parent":{"type":"page_id","page_id":"<부모ID>"},"pages":[{"properties":{"title":"제목"},"content":"본문"}]}
  - 위치를 말하지 않았으면 {"creation_mode":"draft","pages":[…]} → 내 개인 페이지로 만들어진다고 알린다
- 끝에 추가: `notion-update-page` {"page_id":"…","command":"insert_content","content":"추가할 글"}
- 일부 고치기: `notion-update-page` {"page_id":"…","command":"update_content","content_updates":[{"old_str":"원래 문장","new_str":"바꿀 문장"}]}
- 댓글: `notion-create-comment` {"page_id":"…","markdown":"댓글"}

순서:
1. 사용자는 제목으로 말한다. search 로 찾아 제목이 맞는 것을 쓴다. 여러 개면 제목과 위치를 보여 주고 고르게 한다. ID를 짐작하지 않는다.
2. 고치기 전에는 반드시 fetch 로 먼저 읽고, old_str 는 읽은 글에서 그대로 복사한다.
3. 만들기·추가·고치기는 대상 페이지 제목과 넣을 글을 한 번 보여 준다. 사용자가 글을 정확히 줬으면 바로 실행한다.
4. 실행 뒤 fetch 로 다시 읽어 바뀐 부분이 들어갔는지 확인하고 페이지 주소를 알린다.

하지 않는 것: 전체 내용 바꾸기(`replace_content`), 페이지·데이터베이스 삭제, 옮기기는 요청받아도 먼저 무엇이 바뀌는지 보여 주고 확인받는다. 확인 없이 실행하지 않는다.
