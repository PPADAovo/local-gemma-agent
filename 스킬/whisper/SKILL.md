---
name: whisper
description: 음성·녹음·영상 파일을 글로 받아쓰거나, 마이크로 잠깐 녹음해 받아쓸 때 사용한다 (Whisper, 이 PC에서 실행, 한국어).
---
# Whisper 받아쓰기

도구:
- 파일: run text=`python '<스킬폴더>\transcribe.py' '<파일 전체 경로>'` → 같은 폴더에 `<파일이름>.txt` 저장, 글 전체를 출력
- 마이크: run text=`python '<스킬폴더>\transcribe.py' --record <초>` → 임시 폴더의 `whisper-record.txt` 에 저장
- mp3, m4a, wav, mp4 등 대부분 된다. 언어는 한국어로 고정돼 있다.
- 그래픽카드(CUDA)가 되면 큰 모델(large-v3-turbo), 안 되면 작은 모델(small, CPU)로 자동으로 바뀐다.

준비 확인 (처음 한 번):
1. run text=`python -c "import faster_whisper; print('ok')"`
2. 아무것도 안 나오거나 Microsoft Store가 열리면 Python이 설치되지 않은 것이다(이 PC의 python 은 Store 바로가기일 수 있다). 승인을 받아 run text=`winget install --id Python.Python.3.12 -e` 후 앱을 다시 켜야 한다고 알린다.
3. "No module named" 가 나오면 승인을 받아 run text=`python -m pip install faster-whisper "av<17" sounddevice nvidia-cublas-cu12 "nvidia-cudnn-cu12>=9,<10"`
   - av 17 이상은 faster-whisper 1.2 와 맞지 않는다("metadata_errors" 오류). nvidia 두 개는 그래픽카드로 돌리는 데 필요하다.
   - 그래픽카드로 안 되면 스크립트가 알아서 CPU로 다시 한다. 마지막 줄의 "사용:" 에 어느 쪽으로 했는지 나온다.

순서:
1. 파일 경로를 확인한다. 이름만 말하면 list 나 run text=`Get-ChildItem -LiteralPath '<폴더>' -Recurse -Include *.m4a,*.mp3,*.wav,*.mp4 | Select-Object -First 20 FullName` 으로 찾아 고르게 한다.
2. 실행 전에 "길이에 따라 몇 분 걸릴 수 있다"고 알린다. 1시간 넘는 파일은 CPU에서 아주 오래 걸릴 수 있다.
3. 출력 끝의 "저장: <경로>"를 확인하고 경로를 알린다. 글이 길면 앞부분 몇 줄과 요약만 보여 준다.
4. 사용자가 원하면 요약·회의록·할 일 목록으로 정리한다. 원문 .txt 는 그대로 두고 정리한 글은 따로 보여 주거나 저장한다.

주의:
- 받아쓰기는 이름·숫자·전문 용어가 틀릴 수 있다고 알린다. 중요한 숫자는 원본으로 확인하라고 말한다.
- 다른 사람과의 대화를 녹음 파일로 받아쓸 때는 그 내용을 다른 곳에 보내거나 올리지 않는다.
