---
name: visualize
description: 숫자나 구조를 차트·표·그림 화면으로 보여 달라는 요청에 사용한다(canvas 도구로 HTML 생성).
---
# 시각화

canvas 도구로 HTML 화면을 만든다. path=이름, text=완전한 HTML. 만들면 PC 브라우저로 열리고 같은 와이파이의 휴대폰에서 볼 주소가 나온다.

순서:
1. 데이터를 확인한다. 파일이면 read로 읽고, 숫자가 없으면 지어내지 말고 묻는다. 계산이 필요하면 calc로 한다.
2. 모양을 고른다: 시간에 따른 변화는 선, 항목 비교는 막대, 전체 중 비율은 도넛(항목 5개 이하), 값 찾아보기는 표, 순서·흐름은 상자와 화살표.
3. canvas 실행. 차트는 `<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1"></script>` 를 쓴다.
4. 결과로 온 주소를 알려 준다. 사용자가 고쳐 달라고 하면 같은 path로 다시 canvas를 실행해 덮어쓴다.

차트 뼈대:
```
<h2>제목</h2><canvas id="c" style="max-width:900px"></canvas>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1"></script>
<script>new Chart(document.getElementById('c'),{type:'bar',data:{labels:['1월','2월'],datasets:[{label:'매출(만원)',data:[120,150]}]},options:{scales:{y:{beginAtZero:true}}}});</script>
```

규칙:
- 축과 범례에 단위를 적는다(만원, %, 명).
- 화면 위에 한 줄 결론을 적는다(예: "2월 매출이 1월보다 25% 늘었습니다").
- 인터넷이 꺼져 있으면 chart.js를 못 불러온다. 그때는 표(<table>)로 만든다.
- 엑셀 파일로 달라고 하면 이 스킬이 아니라 make_xlsx를 쓴다.
