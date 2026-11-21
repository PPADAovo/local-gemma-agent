---
name: autopilot
description: 열어 둔 GitHub PR을 병합할 수 있는 상태로 관리할 때 사용한다(리뷰 댓글 처리, 충돌 해결, CI 수정).
---
# PR 관리

GitHub 정보는 연결된 GitHub 서비스로 읽는다(gh 프로그램은 없어도 된다). 쓰는 법: plugin_search text=`github <도구이름>` 으로 입력 형식 확인 → plugin_call path=`github.<도구이름>`. 저장소는 `소유자/저장소` 형식.
코드 수정·커밋·push 는 이 PC의 프로젝트 폴더에서 git 으로 한다.

준비: plugin_call path=`github.get_user_login` text=`{}` 로 연결을 확인한다. PR 번호를 모르면 `get_users_recent_prs_in_repo` {"repository_full_name":"…","state":"open"} 로 보여 주고 고르게 한다.

한 바퀴 (모든 run 앞에 `Set-Location -LiteralPath '<프로젝트 폴더>';`):
1. 상태 확인: `get_pr_info` 와 `get_pr_mergeability` {"repository_full_name":"…","pr_number":<번호>}, 검사 상태는 `get_pr_statuses`.
2. CI 실패가 있으면: `fetch_commit_workflow_runs` {"repo_full_name":"…","commit_sha":"<PR 마지막 커밋>"} → `fetch_workflow_run_jobs` 로 실패한 작업을 찾고 → `fetch_workflow_job_logs` 로 로그를 읽는다 → 원인 파일을 read로 읽고 edit로 고친다 → 같은 검사를 로컬에서 run으로 다시 돌려 통과를 확인한다.
3. 충돌이 있으면: run text=`git fetch origin; git merge origin/<기준 브랜치>` → 충돌 파일을 read로 읽는다. 어느 쪽이 맞는지 분명하면 edit로 정리하고, 분명하지 않으면 멈추고 사용자에게 묻는다.
4. 리뷰 댓글: `fetch_pr_comments` 와 `list_pull_request_review_threads` 로 읽는다. 고치라는 내용이 분명하면 고친다. 의견이 갈리는 댓글, 설계를 바꾸라는 댓글은 답하지 말고 사용자에게 보여 준다.
5. 고친 것이 있으면 run text=`git add -A; git commit -m "<무엇을 고쳤는지>"` → push는 처음 한 번 확인받고, 그 뒤로 이 PR에 한해 이어서 진행한다. push 할 때 GitHub 로그인 창이 뜨면 사용자가 직접 로그인하게 한다.
6. note text="PR <번호>: 고친 것 / 남은 것" 을 남긴다.

끝내는 조건: 검사가 모두 통과하고 충돌이 없으면 사용자에게 알리고 멈춘다. 병합(`merge_pull_request`)과 자동 병합 켜기(`enable_auto_merge`)는 사용자가 직접 지시했을 때만 한다. 댓글 답하기는 `reply_to_review_comment`, 해결 표시는 `resolve_review_thread`.
계속 지켜보기: 사용자가 원하면 loop 스킬로 `every 30` 예약을 만든다. 같은 실패를 세 번 고쳐도 안 되면 반복을 멈추고 알린다.
댓글 달기·리뷰 요청처럼 다른 사람에게 보이는 행동은 내용을 보여 주고 확인받은 뒤에 한다.
