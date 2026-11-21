---
name: share
description: 프로젝트를 잃어버리지 않게 GitHub에 저장·백업하거나 다른 사람과 공유할 때 사용한다.
---
# 프로젝트 저장·백업·공유 (GitHub)

git을 몰라도 되게 한 번에 처리한다. gh 프로그램은 없어도 된다.
준비 확인: run text=`git --version` 과 plugin_call path=`github.get_user_login` text=`{}` (연결된 GitHub 서비스). 안 되면 new-repo 스킬의 준비 단계를 따른다.

저장·백업 (모든 run 앞에 `Set-Location -LiteralPath '<프로젝트 폴더>';`):
1. run text=`git remote -v` → 원격이 없으면 new-repo 스킬로 저장소부터 만든다.
2. run text=`git status --short` → 바뀐 파일을 보여 준다. 비밀 파일(.env, 토큰, config.json)이 있으면 .gitignore에 넣고 알린다.
3. run text=`git add -A; git commit -m "<무엇을 바꿨는지 한 줄>"` (바뀐 것이 없으면 건너뛴다)
4. push는 사용자에게 확인받은 뒤 run text=`git push` (GitHub 로그인 창이 뜨면 user_action text="GitHub 로그인 창에서 직접 로그인해 주세요"로 요청한다)
5. run text=`git log -1 --oneline; git status -sb` 로 올라갔는지 확인하고 결과를 알린다.

공유:
- 저장소 주소: run text=`git remote get-url origin` 으로 `소유자/저장소` 를 알아낸 뒤 plugin_call path=`github.get_repo` text=`{"repository_full_name":"소유자/저장소"}` 로 주소와 공개 여부를 확인한다.
- 특정 사람 초대: 연결된 서비스로는 초대할 수 없다. 사용자가 GitHub 아이디를 주면 browser_open `https://github.com/<소유자>/<저장소>/settings/access` 로 열어 주고, "Add people"에서 직접 초대하도록 안내한다. 초대 뒤 `get_repo_collaborator_permission` 으로 권한을 확인할 수 있다.
- 공개로 바꾸기는 사용자가 "공개"라고 분명히 말했을 때만, 누구나 볼 수 있게 된다고 알리고 확인받은 뒤 진행한다.

이전 상태로 되돌려 달라는 요청은 run text=`git log --oneline -10` 으로 목록을 보여 주고 고르게 한다. 덮어쓰는 명령(reset --hard, push --force)은 쓰지 않는다.
