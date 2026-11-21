// Gemini 구독(Antigravity CLI)의 모델별 사용 한도를 기억해, 한도가 찬 모델은 풀릴 때까지 건너뜁니다.
// 기본 모델이 한도에 걸려도(예: "Individual quota reached ... Resets in 147h22m") 다른 모델로 바로 이어서 일합니다.
// 기록 파일에는 모델 이름과 풀리는 시각만 남깁니다(요청·응답 내용은 남기지 않음).
import {appDataDir} from './app-data.mjs';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// 앞에서부터 씁니다. ''는 CLI의 기본 모델입니다. 제미나이설정.json의 model이 있으면 그것을 맨 앞에 둡니다.
export const MODEL_CHAIN=['','gemini-3.8-flash-medium','gemini-3.8-flash-low'];
const file=()=>path.join(appDataDir(),'gemini-quota.json');
const read=()=>{try{return JSON.parse(fs.readFileSync(file(),'utf8'));}catch{return {};}};

export const isQuotaError=message=>/quota reached|quota exceeded|resource.?exhausted|upgrade your subscription|사용 한도/i.test(String(message||''));

// "Resets in 147h22m51s" → 풀리는 시각(ms). 시간을 못 읽으면 1시간 뒤로 봅니다.
export function resetAt(message,now=Date.now()){
  const m=String(message||'').match(/resets? in\s*(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?\s*(?:(\d+)\s*s)?/i);
  const ms=m&&(m[1]||m[2]||m[3])?((Number(m[1]||0)*60+Number(m[2]||0))*60+Number(m[3]||0))*1000:3600e3;
  return now+ms;
}
export function markExhausted(model,message,now=Date.now()){
  const data=read();data[model||'default']=resetAt(message,now);
  try{fs.mkdirSync(path.dirname(file()),{recursive:true});fs.writeFileSync(file(),JSON.stringify(data));}catch{}
}
// 지금 쓸 수 있는 모델 순서
export function usableModels(preferred='',now=Date.now()){
  const data=read();
  const chain=[...new Set([preferred,...MODEL_CHAIN].filter(m=>m!==undefined))];
  const open=chain.filter(m=>!(data[m||'default']>now));
  return open.length?open:[chain.at(-1)];
}
export function quotaNote(now=Date.now()){
  const data=read();
  const waiting=Object.entries(data).filter(([,until])=>until>now).map(([model,until])=>(model==='default'?'기본 모델':model)+' '+Math.ceil((until-now)/3600e3)+'시간 뒤 풀림');
  return waiting.join(', ');
}
