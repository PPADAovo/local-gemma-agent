---
name: github
description: GitHub 저장소·이슈·PR을 찾고 읽거나, 이슈·댓글을 만들고 PR을 확인할 때 사용한다 (연결된 GitHub 서비스).
---
# GitHub (연결된 서비스)

gh 프로그램 없이 연결된 GitHub 서비스로 처리한다.
- 쓰는 법: plugin_search text=`github <도구이름>` 으로 입력 형식을 확인하고 → plugin_call path=`github.<도구이름>` text=`{JSON}`.
- plugin_search 는 한 번에 8개까지만 보여 준다. 아래 도구 이름을 그대로 넣어 찾는다.
- 저장소 이름은 항상 `소유자/저장소` 형식이다(예: owner/my-app). 입력 칸 이름이 도구마다 `repository_full_name` 또는 `repo_full_name` 으로 다르니 검색 결과의 형식을 따른다.

연결 확인: plugin_call path=`github.get_user_login` text=`{}` → 로그인 이름이 나오면 연결된 것이다. 실패하면 설정의 플러그인에서 GitHub를 다시 연결해 달라고 알린다. 비밀번호·토큰은 묻지 않는다.

읽기 도구:
- 내 저장소 찾기: `search_installed_repositories_v2` {"query":"<이름 일부>"}
- 저장소 정보: `get_repo` {"repository_full_name":"소유자/저장소"}
- 파일 읽기: `fetch_file` {"repository_full_name":"…","path":"README.md"}
- 이슈 찾기: `search_issues` {"query":"<검색어>","repository_full_name":"…","state":"open"}
- 이슈 댓글: `fetch_issue_comments` {"repo_full_name":"…","issue_number":12}
- PR 찾기: `search_prs` {"query":"<검색어>","repository_full_name":"…"} / 내 최근 PR: `get_users_recent_prs_in_repo`
- PR 정보: `get_pr_info` / 바뀐 파일 내용: `fetch_pr_file_patch` / 댓글: `fetch_pr_comments`
- 검사(CI) 상태: `get_pr_info` 결과의 커밋으로 `get_commit_combined_status`

쓰기 도구 (남이 보는 곳에 남는다):
- 이슈 만들기: `create_issue` {"repository_full_name":"…","title":"…","body":"…"}
- 이슈·PR 댓글: `add_comment_to_issue` {"repo_full_name":"…","pr_number":12,"comment":"…"} (이슈 번호도 pr_number 칸에 넣는다)
- 라벨: `add_issue_labels` / `remove_issue_label`
- PR 제목·본문·닫기: `update_pull_request`

순서:
1. 저장소를 이름 일부로 말하면 search_installed_repositories_v2 로 찾는다. 여러 개면 보여 주고 고르게 한다. 짐작해서 채우지 않는다.
2. 읽기는 결과를 요약한다(번호, 제목, 상태, 작성자, 최근 댓글). 긴 내용은 핵심만.
3. 쓰기는 실행 전에 저장소·제목·본문을 그대로 보여 주고 확인받는다. 사용자가 문장을 정확히 줬으면 바로 실행한다.
4. 쓰기 뒤에는 결과의 번호·주소를 확인하고, 읽기 도구로 다시 열어 반영됐는지 본 뒤 알린다.

하지 않는 것(요청받아도 확인 없이 안 함): 파일 삭제(`delete_file`), 브랜치 강제 이동(`update_ref` force), 자동 병합 켜기(`enable_auto_merge`), PR 병합.

이 PC의 프로젝트 폴더에서 하는 git 작업(commit, push)은 run 으로 git 명령을 쓴다. 모든 run 앞에 `Set-Location -LiteralPath '<프로젝트 폴더>';` 를 붙이고, push 는 매번 확인받는다.
PR을 병합 가능한 상태로 계속 관리하는 일은 autopilot 스킬을 쓴다.
