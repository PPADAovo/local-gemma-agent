---
name: github-code
description: 깃허브에서 필요한 코드·예제·라이브러리 사용법을 찾아 내 프로젝트에 적용하고 실행해서 검증할 때 사용한다 (연결된 GitHub 서비스).
---
# 깃허브 코드 찾아 적용하기

연결된 GitHub 서비스(plugin_call)로 찾는다. gh 프로그램은 쓰지 않는다. 비밀번호·토큰은 묻지 않는다.

순서:
1. 찾기 (가장 맞는 것 하나를 고르는 단계, 2~3번 호출 안에 끝낸다)
   - 파일·함수 검색: plugin_call path=`github.search` text=`{"query":"<함수 이름이나 핵심 단어 2~4개>","topn":8}`
   - 저장소 검색: plugin_call path=`github.search_repositories` text=`{"query":"<무엇을 하는 코드인지>","topn":5}`
   - 별(stars)이 많고, 최근까지 관리되고, 내 프로젝트와 언어가 같은 것을 고른다.
2. 읽기: plugin_call path=`github.fetch_file` text=`{"repository_full_name":"소유자/저장소","path":"파일 경로"}`
   - 라이선스 확인: 같은 저장소의 `LICENSE`(또는 `LICENSE.md`)를 fetch_file로 읽는다. MIT·Apache-2.0·BSD는 출처를 남기면 쓸 수 있다. GPL은 사용자에게 먼저 알린다. 라이선스가 없으면 그대로 복사하지 말고 방식만 참고해 직접 작성한다.
3. 적용: 필요한 부분만 내 프로젝트 파일에 write/edit로 넣는다. 저장소 전체를 복사하지 않는다.
   - 코드 위에 출처 주석을 남긴다: `// 출처: https://github.com/소유자/저장소/blob/<브랜치>/<경로> (라이선스)`
   - 내 프로젝트의 이름·스타일·모듈 방식(import/require)에 맞춘다.
4. 검증 (반드시 실행 결과로 확인한다)
   - JS: `check_js`로 문법 검사 → 작은 테스트 파일을 write로 만들고 run `node <테스트파일>`로 실행해 기대값과 비교한다.
   - 프로젝트에 테스트 명령이 있으면(package.json의 test 스크립트 등) 그 명령을 run으로 실행한다.
   - 웹 화면이면 web-preview 스킬 순서로 browser_preview를 열어 확인한다.
   - 실패하면 오류 문구를 읽고 고친 뒤 다시 실행한다. 같은 방법으로 3번 실패하면 다른 코드를 찾는다.
5. 보고: 어디서 가져왔는지(주소·라이선스), 어느 파일에 무엇을 넣었는지, 실행한 검증과 결과를 짧게 알린다.

하지 않는 것:
- 남의 저장소에 이슈·댓글·커밋을 만들지 않는다(요청받은 경우만, 확인 후).
- 검증 없이 "적용했다"고 보고하지 않는다.
- 내 프로젝트를 깃허브에 올리는 일(push, 새 저장소)은 new-repo·share 스킬을 따르고 매번 확인받는다.
