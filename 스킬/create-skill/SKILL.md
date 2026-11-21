---
name: create-skill
description: 새 스킬(작업 설명서)을 이 PC의 스킬 폴더에 만들거나 기존 스킬을 고칠 때 사용한다.
---
# 스킬 만들기

스킬은 `스킬\<이름>\SKILL.md` 파일 하나다. 저장하면 다음 대화부터 목록에 나온다(빌드 필요 없음).

순서:
1. 무엇을 하는 스킬인지, 언제 쓰는지 모르면 reply(needsInput=true)로 한 번만 묻는다.
2. 이름을 정한다: 영문 소문자·숫자·하이픈만 (예: weekly-report). list path=`<스킬폴더>\..` 로 같은 이름이 있는지 확인한다. 있으면 read로 읽고 edit로 고친다.
3. write path=`<스킬폴더>\..\<이름>\SKILL.md` text=아래 형식 전체.
4. read로 다시 읽어 맨 위 세 줄(---, name, description)이 맞는지 확인한 뒤 완료를 알린다.

형식:
```
---
name: <이름>
description: <언제 쓰는지 한 줄, 80자 이내>
---
# <제목>

준비: <필요한 프로그램·설정. 없으면 생략>
사용: <어떤 도구를 어떤 값으로 부르는지 순서대로>
확인: <끝났는지 확인하는 방법>
```

규칙:
- description은 반드시 한 줄. 매 대화에 그대로 보이므로 짧게 쓴다.
- 본문에는 실제로 있는 도구 이름만 쓴다(run, read, write, edit, list, canvas, make_xlsx, make_ppt, schedule_add, browser_open 등).
- 토큰·비밀번호가 필요하면 같은 폴더 config.json에 빈 칸을 만들고 "사용자가 직접 넣는다"고 적는다. 값은 묻지도 적지도 않는다.
- 스크립트가 필요하면 같은 폴더에 .ps1 또는 .py로 저장하고 본문에서 `<스킬폴더>\파일이름` 으로 부른다.
