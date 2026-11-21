---
name: new-repo
description: 현재 프로젝트 폴더를 GitHub 비공개 저장소로 처음 올릴 때 사용한다(원격 저장소가 없을 때).
---
# 새 GitHub 저장소 만들기

gh 프로그램 없이 처리한다. 저장소 만들기는 GitHub 웹사이트에서, 올리기는 git 으로, 확인은 연결된 GitHub 서비스로 한다.

준비:
- run text=`git --version` → 없으면 승인을 받아 run text=`winget install --id Git.Git -e`.
- plugin_call path=`github.get_user_login` text=`{}` → 내 GitHub 아이디(<아이디>)를 확인한다. 실패하면 설정의 플러그인에서 GitHub를 연결해 달라고 알린다.

순서 (모든 run 앞에 `Set-Location -LiteralPath '<프로젝트 폴더>';`):
1. run text=`git remote -v` → 이미 원격이 있으면 새로 만들지 말고 share 스킬을 따른다.
2. run text=`git status` → 저장소가 아니면 `git init -b main` 을 실행한다.
3. .gitignore가 없으면 write로 만든다: node_modules/, .env, *.log, config.json, 두뇌설정.json 등 비밀·대용량 파일을 넣는다.
4. run text=`git status --short` 로 올라갈 파일을 보여 주고, 비밀 파일(.env, 토큰, 키)이 있으면 제외한 뒤 사용자에게 확인받는다.
5. run text=`git add -A; git commit -m "첫 커밋"`
6. 저장소 이름(<이름>, 영문·숫자·-)을 사용자에게 확인받는다.
7. 저장소 만들기: browser_open `https://github.com/new?name=<이름>&visibility=private` → look 으로 화면을 본다.
   - 로그인돼 있고 이름·Private 가 맞으면, 사용자 확인을 받은 뒤 "Create repository" 버튼을 click 한다.
   - 로그인 화면이면 user_action text="GitHub 창에서 직접 로그인해 주세요"로 요청하고 기다린다. 비밀번호는 입력하지 않는다.
8. 만들어졌는지 확인: plugin_call path=`github.get_repo` text=`{"repository_full_name":"<아이디>/<이름>"}`
9. 올리기: run text=`git remote add origin https://github.com/<아이디>/<이름>.git; git push -u origin HEAD`
   - GitHub 로그인 창이 뜨면 user_action text="GitHub 로그인 창에서 직접 로그인해 주세요"로 요청한다.
10. run text=`git status -sb` 와 get_repo 결과로 주소와 비공개 여부를 확인해 알려 준다.

공개는 사용자가 "공개"라고 분명히 말했을 때만 쓴다(주소의 visibility=public).
