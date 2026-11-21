export function browserTaskLabel(request=''){
  const text=String(request);
  if(/사진|이미지|photo|image/i.test(text)){
    const subject=/토끼|rabbit/i.test(text)?'🐰 토끼':/고양이|cat photo/i.test(text)?'🐱 고양이':/강아지|개 사진|dog photo/i.test(text)?'🐶 강아지':'🖼️';
    return {title:subject+' 사진 '+(/비교|compare/i.test(text)?'비교':'찾기'),color:'orange'};
  }
  if(/캘린더|달력|calendar/i.test(text))return {title:'🗓️ 캘린더 확인',color:'purple'};
  if(/메일|gmail/i.test(text))return {title:'✉️ 메일 확인',color:'blue'};
  if(/유튜브|youtube/i.test(text))return {title:'▶️ 유튜브 확인',color:'red'};
  if(/로그인|log[ -]?in|sign[ -]?in/i.test(text))return {title:'🔑 로그인 확인',color:'yellow'};
  if(/비교|가격|compare/i.test(text))return {title:'🔎 자료 비교',color:'cyan'};
  if(/검색|조사|찾|search/i.test(text))return {title:'🔎 자료 찾기',color:'cyan'};
  return {title:'🌐 웹 작업',color:'blue'};
}
