// 웹사이트 로그인 대신 입력하기.
// - 저장된 로그인 정보가 있으면 그대로 넣습니다. 없으면 카드로 아이디와 비밀번호(가려진 입력칸)를 받아 이 PC에만 암호화 저장합니다.
// - 비밀번호는 모델·작업 로그·채팅 기록·진행 문구로 보내지 않습니다. 카드 답이 거쳐 가는 우편함 파일의 값도 바로 가립니다.
// - Google 계정 로그인은 자동 입력하지 않습니다(Google이 자동화된 로그인을 막고, 2단계 인증도 사람이 해야 함).
import fs from 'node:fs/promises';
import {askCard} from './human-handoff.mjs';
import {saveSiteLogin,readSiteLogin,forgetSiteLogin} from './secrets.mjs';

export const MANUAL='직접 로그인할게요';
const STOP='작업 중지';

// 우편함(jsonl)에서 이 답들을 [가림]으로 바꿉니다. 줄 수는 그대로 둡니다(에이전트가 줄 번호로 새 줄을 셉니다).
export async function maskInboxAnswers(answers,inbox=process.env.GEMMA_INBOX){
  const secrets=new Set(answers.filter(Boolean).map(a=>String(a).trim()));
  if(!inbox||!secrets.size)return;
  try{
    const text=await fs.readFile(inbox,'utf8');
    const masked=text.split('\n').map(line=>{
      try{const row=JSON.parse(line);
        for(const key of ['answer','text'])if(typeof row[key]==='string'&&secrets.has(row[key].trim()))row[key]='[가림]';
        return JSON.stringify(row);}catch{return line;}
    }).join('\n');
    if(masked!==text)await fs.writeFile(inbox,masked);
  }catch{}
}

// 반환: 'filled'(입력·제출함) | 'manual'(사용자가 직접) | 'stop'
// fill: 페이지에 값을 넣는 함수(browser.mjs의 fillLoginForm). ask/store는 시험용으로 바꿔 끼울 수 있습니다.
export async function loginForUser(host,{fill,ask=askCard,store={save:saveSiteLogin,read:readSiteLogin,forget:forgetSiteLogin},inbox=process.env.GEMMA_INBOX,retry=false}={}){
  if(!host || /(^|\.)accounts\.google\.com$/i.test(host))return 'manual';
  let creds=retry?null:await store.read(host);
  if(retry)await store.forget(host);
  if(!creds){
    const username=String(await ask({kind:'question',title:host+' 로그인',showBrowser:true,
      question:(retry?'저장된 정보로는 로그인되지 않았어요. ':'')+host+'에 로그인이 필요해요. 아이디(학번·이메일 등)를 입력해 주시면 다음 칸에서 비밀번호를 받아 제가 대신 입력할게요.\n직접 로그인하시려면 ['+MANUAL+']를 눌러 주세요.',
      options:[MANUAL,STOP]})||'').trim();
    if(!username||username===STOP)return 'stop';
    if(username===MANUAL)return 'manual';
    const password=String(await ask({kind:'question',secret:true,title:host+' 비밀번호',showBrowser:true,
      question:'비밀번호를 입력해 주세요. 이 PC에만 암호화해 저장하고 제가 로그인 칸에 직접 넣어요. AI 모델·로그·채팅 기록에는 남기지 않아요.',
      options:[MANUAL,STOP]})||'');
    await maskInboxAnswers([username,password],inbox);
    if(!password||password===STOP)return 'stop';
    if(password===MANUAL)return 'manual';
    creds={username,password};
    await store.save(host,creds);
  }
  const result=await fill(creds);
  creds=null;
  return result?.ok?'filled':'manual';
}
