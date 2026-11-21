---
name: pdf
description: PDF를 만들거나 합치기·나누기·글자 뽑기·쪽수 확인을 해 달라는 요청에 사용한다.
---
# PDF

읽기: 사용자가 PDF를 첨부하면 글자로 읽힌다. 경로만 있을 때는 아래 text 동작을 쓴다.

합치기·나누기·글자 뽑기 — Python과 pypdf 필요. 준비 확인: run text=`python -c "import pypdf; print('ok')"`
- 아무것도 안 나오거나 Microsoft Store가 열리면 Python이 없는 것이다(이 PC의 python 은 Store 바로가기일 수 있다). 승인을 받아 run text=`winget install --id Python.Python.3.12 -e` → 앱을 다시 켜야 한다고 알린다.
- "No module named" 가 나오면 승인을 받아 run text=`python -m pip install pypdf`.
- 쪽수 확인만 필요하고 Python이 없으면, 사용자가 PDF를 채팅에 첨부하면 읽을 수 있다고 안내한다.
- 쪽수 확인: run text=`python '<스킬폴더>\pdf-tools.py' info '<파일.pdf>'`
- 글자 뽑기: run text=`python '<스킬폴더>\pdf-tools.py' text '<파일.pdf>' '<출력.txt>'`
- 합치기: run text=`python '<스킬폴더>\pdf-tools.py' merge '<출력.pdf>' '<입력1.pdf>' '<입력2.pdf>'` (적은 순서대로 합쳐진다)
- 나누기: run text=`python '<스킬폴더>\pdf-tools.py' split '<파일.pdf>' <시작쪽> <끝쪽> '<출력.pdf>'` (쪽 번호는 1부터)
원본은 바뀌지 않고, 이미 있는 출력 파일은 덮어쓰지 않는다.

만들기 (HTML → PDF, Chrome 또는 Edge 사용):
1. write path=<이름>.html 로 인쇄용 HTML을 쓴다. 맨 위 style에 `@page{size:A4;margin:18mm}` 와 `body{font-family:"Malgun Gothic";font-size:11pt;line-height:1.6}` 를 넣는다. 표가 쪽 사이에서 잘리지 않게 `tr{break-inside:avoid}` 를 넣는다.
2. run text=`& '<스킬폴더>\html-to-pdf.ps1' '<이름>.html' '<이름>.pdf'`
3. run text=`Get-Item -LiteralPath '<이름>.pdf' | Select-Object Length` 로 파일이 생겼는지 보고(Python이 있으면 `python '<스킬폴더>\pdf-tools.py' info '<이름>.pdf'` 로 쪽수까지 확인) open_file로 연다.

확인: 결과 쪽수가 예상과 맞는지 반드시 본다(합치기는 입력 쪽수의 합, 나누기는 끝쪽-시작쪽+1).
못 하는 것: 스캔한 그림 PDF의 글자 인식, 암호 풀기, 양식 칸 채우기, 전자 서명. 요청받으면 못 한다고 말한다.
