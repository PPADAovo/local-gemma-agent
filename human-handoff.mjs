import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';

// card.until: 카드가 떠 있는 동안 몇 초마다 확인할 함수. 참을 돌려주면(예: 잠금이 저절로 풀림) 사용자의 답 없이
// 카드를 닫고 card.untilAnswer(기본 '__상태 해결됨__')를 돌려줍니다. 함수는 카드 내용(JSON)에 실리지 않습니다.
export const RESOLVED='__상태 해결됨__';
export async function askCard(card,inbox=process.env.GEMMA_INBOX,emit=line=>process.stderr.write(line+'\n')){
  const askId=randomUUID();
  if(!inbox)throw Error(card.question);
  const {until,untilEvery=4000,untilAnswer=RESOLVED,...shown}=card;
  emit('@ask '+JSON.stringify({...shown,askId}));
  let nextCheck=Date.now()+untilEvery;
  try{
    while(true){
      if(typeof until==='function' && Date.now()>=nextCheck){
        let done=false;try{done=await until();}catch{}
        if(done)return untilAnswer;
        nextCheck=Date.now()+untilEvery;
      }
      let lines='';
      try{lines=await fs.readFile(inbox,'utf8');}catch(e){if(e.code!=='ENOENT')throw e;}
      for(const line of lines.split('\n').slice(0,-1)){
        let reply;try{reply=JSON.parse(line);}catch{continue;}
        if(reply.askId===askId && typeof reply.answer==='string')return reply.answer;
      }
      await delay(300);
    }
  }finally{emit('@askdone '+JSON.stringify(askId));}
}

export function browserGate(page){
  if(typeof page!=='string')return;
  const url=page.match(/^주소: (https?:\/\/\S+)/m);
  if(!url)return;
  const {hostname,pathname}=new URL(url[1]);
  const google=hostname==='accounts.google.com';
  const body=page.split('본문 일부:\n').at(-1);
  if(google && /브라우저 또는 앱이 안전하지|브라우저나 앱이 안전하지|browser or app may not be secure|\/deniedsigninrejected/i.test(body+' '+pathname))
    return {kind:'blocked',title:'Google이 작업 브라우저의 로그인을 차단했습니다',question:'이 창에서 같은 로그인을 다시 시도해도 진행할 수 없습니다. 다른 자료로 이어가려면 아래에 사용할 파일 경로나 공개 링크를 적어 주세요. 현재 화면은 ‘작업 창 보기’로 확인할 수 있습니다.'};
  if((google && /2단계 인증|2-Step Verification|휴대전화에서 확인|Check your phone/i.test(body)) || /\[input:[^\]]*\] (?:인증 코드|Verification code)|\[one-time-code\]/i.test(page))
    return {kind:'input',title:'본인 인증 대기',question:'작업 창에 표시된 본인 인증을 직접 완료한 뒤 아래 버튼을 눌러 주세요. 인증 코드는 해당 사이트에만 입력하세요.'};
  if(google && /\/consent|\/oauth.*approval/i.test(pathname))
    return {kind:'approval',title:'사이트 권한 승인 대기',question:'작업 창에서 서비스 이름과 요청 권한을 확인하고 허용 여부를 직접 선택해 주세요.'};
  if((google && /challenge/i.test(pathname)) || /\[input:password\]/i.test(page))
    return {kind:'input',title:'로그인 대기',question:'‘작업 창 보기’를 눌러 해당 사이트에 직접 로그인한 뒤 아래 버튼을 눌러 주세요. 비밀번호는 사이트에만 입력하세요.'};
}
