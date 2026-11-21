---
name: image-gen
description: 그림·이미지를 새로 만들어 달라는 요청에 사용한다 (기본: 무료 AI Horde, 이 PC에 Stable Diffusion이 켜져 있으면 그것).
---
# 이미지 생성

방법은 두 가지다. 먼저 이 PC의 Stable Diffusion이 켜져 있는지 보고, 없으면 무료 외부 생성기를 쓴다.
확인: run text=`try{Invoke-RestMethod -TimeoutSec 3 ((Get-Content -LiteralPath '<스킬폴더>\config.json' -Raw | ConvertFrom-Json).url.TrimEnd('/')+'/sdapi/v1/sd-models') | Select-Object -First 1 -Expand title}catch{'꺼짐'}`

A. 기본 — 무료 외부 생성기 (AI Horde, 설치 필요 없음, 512×512)
1. find_free_tool text=`image-generation` 을 먼저 실행한다(이걸 안 하면 generate_image 가 거절된다).
2. generate_image text=`<영어 그림 설명>` path=`이미지\<짧은영문이름>.png`
   - 그림 설명은 외부 자원봉사 서버로 간다. 이름·주소·사진 속 실제 인물 같은 개인 정보는 넣지 않는다.
   - 혼잡하면 몇 분 기다리거나 거절될 수 있다. 거절되면 한 번만 다시 시도하고, 그래도 안 되면 알린다.

B. 이 PC의 Stable Diffusion (위 확인에서 모델 이름이 나왔을 때만, 더 크고 선명하다)
- run text=`& '<스킬폴더>\imagegen.ps1' "<영어 프롬프트>" <가로> <세로> "<빼고 싶은 것(선택)>"` → `작업공간\이미지\image-<시각>.png`
- 크기: 정사각형 1024 1024, 가로 1344 768, 세로 768 1344 (64의 배수).

공통 순서:
1. 무엇을 그릴지 분명하지 않으면(대상·분위기·용도) 한 번만 묻는다. "아무거나"면 그대로 진행한다.
2. 한국어 요청을 영어 프롬프트로 바꾼다. 형식: 대상, 동작/배경, 화풍, 조명, 품질어. 예: "a cute cat in a spacesuit floating in space, digital illustration, soft lighting, highly detailed"
3. 생성 뒤 read path=<저장 경로> 로 그림을 직접 보고, 요청과 맞는지 한두 줄로 설명하고 경로와 쓴 영어 프롬프트를 알린다.
4. 요청과 크게 다르면 프롬프트를 고쳐 한 번 더 만든다. 그래도 안 되면 두 장을 모두 보여 주고 어떻게 바꿀지 묻는다.

A는 512×512 로 작다. 큰 그림이 꼭 필요하면 Stable Diffusion WebUI/Forge를 `--api` 로 켜면 B를 쓸 수 있다고 알린다.
실존 인물의 사진처럼 보이는 그림, 다른 사람을 흉내 낸 가짜 증명·문서 이미지는 만들지 않는다.
