---
name: spotify
description: 음악 재생·일시정지·다음/이전 곡·볼륨·음소거(Spotify, YouTube Music, 브라우저 등 지금 재생 중인 플레이어), Spotify에서 곡을 찾아 틀 때 사용한다.
---
# 음악 / Spotify

도구: run text=`& '<스킬폴더>\media.ps1' <동작>`
- 재생/일시정지: `playpause` (같은 키라서 한 번 누를 때마다 바뀐다)
- 다음 곡 / 이전 곡: `next` / `prev`
- 볼륨: `volup` / `voldown` (한 번에 5칸, 약 10%) / `mute` (켜고 끄기 전환)
- Spotify 검색: `search "아이유 밤편지"`

동작은 Windows 미디어 키를 누르는 것이라 지금 소리를 내는 프로그램에 적용된다. 어느 플레이어인지 고를 수 없다.

곡 틀기 (search):
1. run text=`& '<스킬폴더>\media.ps1' search "가수 곡제목"` → Spotify 앱이 검색 화면으로 열린다. 앱이 없으면 browser_open https://open.spotify.com/search/<검색어> 로 연다.
2. wait 2초 뒤 look 으로 검색 결과를 본다.
3. 요청한 곡과 제목·가수가 맞는 줄을 double_click 한다. 맞는 곡이 없으면 비슷한 후보를 알려 주고 묻는다.
4. look 으로 화면 아래 재생 표시줄의 곡 이름이 바뀌었는지 확인한 뒤 "재생 중: <곡> - <가수>"라고 알린다.

규칙:
- "멈춰", "꺼 줘"는 playpause 한 번이다. 이미 멈춘 상태였으면 오히려 재생되므로, 확실하지 않으면 look 으로 상태를 보고 판단한다.
- "볼륨 많이 올려"처럼 양이 크면 volup 을 두세 번 실행한다. 정확한 % 설정은 할 수 없다고 말한다.
- 미디어 키는 결과가 화면에 안 남는다. 스크립트 출력만으로 "됐다"고 하지 말고, 확인이 필요하면 look 으로 본다.
