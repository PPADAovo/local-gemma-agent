// 잠긴 앱의 비밀번호를 카드로 물어 바로 암호화 저장합니다.
// 값은 모델·로그·작업 기록으로 보내지 않고, 우편함 파일에 남은 답도 [저장됨]으로 가립니다.
import fs from 'node:fs/promises';
import {APPS,extractAppPassword,saveSecret} from './secrets.mjs';
import {askCard} from './human-handoff.mjs';

// 사용자의 답에서 비밀번호만 꺼냅니다. 낱말·문장으로 답한 경우("내가 풀었어" 등)는 비밀번호가 아닙니다.
export function secretFromAnswer(answer){
  const text=String(answer??'').trim();
  const secret=extractAppPassword(text)?.secret||text
    .replace(/^(?:비밀\s*번호|비번|암호|PIN)\s*(?:은|는|:|=)?\s*/i,'')
    .replace(/\s*(?:이야|야|입니다|이에요|예요|에요|임)[.!]*$/,'').trim();
  if(!secret || /\s|[가-힣ㄱ-ㅣ]/.test(secret) || secret.length>64)return '';
  return secret;
}

// 반환: 'saved'(저장함) | 'manual'(사용자가 직접 풂) | 'stop'
export async function askAppSecret(app,retry=false,{ask=askCard,save=saveSecret,inbox=process.env.GEMMA_INBOX,until=null}={}){
  if(!APPS[app])return 'manual';
  const label=APPS[app].label;
  // until: 카드가 떠 있는 동안 잠금이 저절로(Windows Hello 등) 풀렸는지 확인 → 풀리면 카드를 닫고 'manual'로 이어 갑니다.
  const answer=String(await ask({kind:'question',secret:true,title:label+' 잠금 비밀번호',...(until?{until,untilAnswer:'직접 풀었어요'}:{}),
    question:(retry?'저장된 비밀번호로는 잠금이 풀리지 않았어요. ':'')+label+'이(가) 잠겨 있어요. 잠금 비밀번호를 입력해 주시면 이 PC에만 암호화해 저장하고 제가 대신 입력할게요. AI 모델에게는 보내지 않아요.\n직접 푸셨다면 [직접 풀었어요]를 눌러 주세요.',
    options:['직접 풀었어요','작업 중지']})||'').trim();
  if(!answer || answer==='작업 중지')return 'stop';
  if(answer==='직접 풀었어요')return 'manual';
  const secret=secretFromAnswer(answer);
  if(!secret)return 'manual';
  await save(app,secret);
  // 답은 우편함 파일을 거쳐 옵니다. 줄 수는 그대로 두고 답만 가립니다.
  try{
    const text=await fs.readFile(inbox,'utf8');
    const masked=text.split('\n').map(line=>{
      try{const row=JSON.parse(line);if(typeof row.answer==='string' && row.answer.trim()===answer){row.answer='[저장됨]';return JSON.stringify(row);}}catch{}
      return line;
    }).join('\n');
    if(masked!==text)await fs.writeFile(inbox,masked);
  }catch{}
  return 'saved';
}
