// AI 구독(Claude·ChatGPT·Gemini) 사용량·남은 한도 확인 요청 처리.
// 2026-11-21: "제미나이 클로드 지피티 사용량 알려줘"에 ① "각자 직접 확인하세요"로 떠넘기고 ② 없는 주소
// (gemini.google.com/app/login, /app/usage)를 지어내 열고 ③ 이미 로그인된 사용자 Chrome 대신 연결 안 된
// 작업 브라우저만 반복 호출했습니다. 실제 사용량 페이지 주소를 알려 주고, 사용자 Chrome에서 열어 화면을 읽게 합니다.

export const AI_USAGE_PAGES=[
  {id:'claude',name:'Claude',match:/클로드|claude|clau\.de/i,url:'https://claude.ai/settings/usage'},
  {id:'chatgpt',name:'ChatGPT·Codex',match:/지피티|쥐피티|gpt|chatgpt|챗gpt|챗지피티|codex|코덱스|openai|오픈ai/i,url:'https://chatgpt.com/codex/settings/usage'},
  {id:'gemini',name:'Gemini',match:/제미나이|제미니|gemini/i,url:'https://gemini.google.com/app',
    note:'Gemini 웹에는 사용량 전용 페이지가 없을 수 있습니다. 화면에서 사용량·한도 표시를 찾아보고, 없으면 "웹 화면에 사용량 표시가 없다"고 사실대로 보고하세요(주소를 지어내지 마세요).'}
];
const ASKS_USAGE=/사용량|사용\s*한도|남은\s*(?:한도|양|사용)|한도|리밋|limit|usage|quota|쿼터|얼마나\s*(?:썼|남)/i;

// 지금 요청(또는 이어지는 최근 대화)이 AI 구독 사용량을 묻는지와, 어떤 서비스인지 돌려줍니다.
// "로그인 되어있잖아"처럼 앞 요청을 이어 가는 말도 잡도록 최근 사용자 말 3개까지 함께 봅니다.
export function usageRequest(input,recent=[]){
  const own=String(input||'');
  const earlier=recent.filter(m=>m?.role==='user').slice(-3).map(m=>String(m.content||''));
  for(const text of [own,[...earlier,own].join('\n')]){
    if(!ASKS_USAGE.test(text))continue;
    const pages=AI_USAGE_PAGES.filter(p=>p.match.test(text));
    if(pages.length)return pages;
  }
  return [];
}

export function usageHint(pages,{localNote=''}={}){
  return ['(사용량 확인 안내) 사용자는 아래 AI 구독의 현재 사용량과 남은 한도를 직접 확인해 달라고 했습니다.',
    '사용자 Chrome은 이미 로그인돼 있습니다. 다음 순서로 직접 하세요:',
    '1. open_page로 아래 주소를 하나씩 엽니다(사용자의 로그인된 Chrome에 열림). 작업 브라우저(browser_open)는 로그인이 안 돼 있으니 쓰지 마세요.',
    '2. 열 때마다 look으로 화면을 읽어 사용량(%, 남은 양)과 초기화(리셋) 시각을 그대로 옮겨 적습니다. 안 보이면 scroll 후 다시 look 하세요.',
    '3. 로그인 화면이 실제로 보일 때만 user_action으로 로그인을 부탁합니다.',
    '4. 아래에 없는 주소를 지어내지 마세요. "각 서비스에서 직접 확인하세요" 같은 안내로 끝내지 마세요.',
    ...pages.map(p=>'- '+p.name+': '+p.url+(p.note?' ('+p.note+')':'')),
    ...(localNote?['참고(이 앱이 기록한 Gemini CLI 한도): '+localNote]:[]),
    '마지막 답에는 서비스별로 화면에서 읽은 숫자와 리셋 시각만 표로 보고하고, 읽지 못한 서비스는 그 이유를 적습니다.'
  ].join('\n');
}
