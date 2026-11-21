---
name: split-to-prs
description: 지금까지의 코드 변경을 리뷰하기 쉬운 작은 PR 여러 개로 나눠 달라는 요청에 사용한다.
---
# 작은 PR로 나누기

준비: git 과 연결된 GitHub 서비스가 필요하다(gh 프로그램은 없어도 된다). run text=`git --version; git remote get-url origin` 으로 `소유자/저장소` 를 확인하고, plugin_call path=`github.get_user_login` text=`{}` 로 연결을 확인한다.
모든 run 앞에 `Set-Location -LiteralPath '<프로젝트 폴더>';` 를 붙인다.

순서:
1. 현재 상태 확인: run text=`git status --short; git branch --show-current; git diff --stat`
2. 안전망: run text=`git stash list; git branch backup/split-<오늘날짜>` 로 지금 상태를 가리키는 백업 브랜치를 만든다. 커밋 안 한 변경이 있으면 먼저 `git add -A; git commit -m "wip: 나누기 전 상태"` 로 저장한다.
3. 바뀐 파일을 read로 훑어 묶음을 나눈다. 기준: 한 PR은 한 가지 목적, 따로 병합해도 빌드가 깨지지 않을 것, 리팩터링과 기능 변경은 분리.
4. 나누는 계획을 표로 보여 주고 확인받는다(PR 제목 / 들어갈 파일 / 의존하는 PR).
5. 묶음마다:
   - run text=`git switch -c <브랜치이름> <기준 브랜치>`
   - run text=`git checkout backup/split-<오늘날짜> -- <파일1> <파일2>` (파일 단위로 가져온다)
   - 프로젝트의 테스트나 빌드 명령이 있으면 run으로 돌려 통과를 확인한다.
   - run text=`git add -A; git commit -m "<목적 한 줄>"`
6. push와 PR 만들기는 확인받은 뒤:
   - run text=`git push -u origin <브랜치이름>` (GitHub 로그인 창이 뜨면 user_action text="GitHub 로그인 창에서 직접 로그인해 주세요"로 요청한다)
   - plugin_search text=`github create_pull_request` 로 입력 형식을 확인하고 plugin_call path=`github.create_pull_request` 로 PR을 만든다. 제목, 본문(무엇을, 왜, 어떻게 확인했는지), 기준 브랜치, 내 브랜치를 넣는다.
   - 결과의 PR 번호를 `get_pr_info` 로 다시 열어 확인한다.
7. 끝나면 PR 주소 목록과 병합 순서를 알려 준다.

한 파일 안의 변경을 두 PR로 나눠야 하면 자동으로 하지 말고 사용자에게 어느 부분이 어느 PR인지 묻는다.
백업 브랜치는 지우지 않는다. reset --hard, push --force 는 쓰지 않는다.
