---
name: safety-guard
description: 지우기·덮어쓰기·초기화처럼 되돌리기 어려운 동작이나 위험한 명령(삭제, 포맷, 레지스트리, 강제 푸시)을 실행하기 전에 사용한다. 특정 폴더만 고치라고 했을 때도 사용한다.
---
# 위험한 동작 전 확인 (ECC safety-guard에서 옮김)

원문(영어)은 같은 폴더의 원문.md에 있다. 필요할 때만 read로 연다.

실행 전에 멈추고 사용자에게 무엇을 하는지·대상·되돌릴 수 있는지를 알리고 확인받는 명령
- Remove-Item -Recurse, rm -rf, del /s, rmdir /s, Clear-Content, Format-Volume, format
- reg delete, Set-ItemProperty로 시스템 설정 바꾸기, 서비스·드라이버 중지
- git push --force, git reset --hard, git checkout -- . , git clean -fd
- 여러 파일을 한꺼번에 덮어쓰거나 이름 바꾸기, 데이터베이스 DROP/DELETE
- --no-verify 같은 검사 건너뛰기

더 안전한 방법을 먼저 쓴다
- 지우기는 휴지통으로 옮기기(delete 도구)를 쓰고, 영구 삭제는 사용자가 원할 때만 한다.
- 덮어쓰기 전에 원래 파일을 복구기록에 남기거나 다른 이름으로 저장한다.
- 대상이 몇 개인지 먼저 list로 세고 알린다. 예상보다 많으면 멈춘다.

폴더 제한
- 사용자가 "이 폴더만"이라고 하면 그 밖의 파일은 읽기만 하고 고치지 않는다. 밖을 고쳐야 하면 이유를 말하고 묻는다.
