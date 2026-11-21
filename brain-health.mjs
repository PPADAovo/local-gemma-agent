// 연결 상태 기록: 모델 메뉴에서 쓸 수 없는 연결(크레딧 부족·키 없음·로그인 필요 등)을 빨간색으로 보여 주기 위한 기록입니다.
// %LOCALAPPDATA%\LocalGemmaDesktop\health.json = {"api-gpt":{"ok":false,"reason":"크레딧 부족","at":"..."}, ...}
// 실제로 써 본 결과(성공/실패)와 앱 시작 때의 간단한 확인(로그인·키 유무)으로 갱신합니다.
import {appDataDir} from './app-data.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

export const healthFile=()=>path.join(appDataDir(),'health.json');
export async function readHealth(){try{return JSON.parse(await fs.readFile(healthFile(),'utf8'));}catch{return {};}}
// 기록이 동시에 여러 번 쓰여도 깨지지 않게, 읽고 → 합치고 → 임시 파일 → 바꿔치기 순서로 씁니다.
export async function record(updates){
  try{
    const data=await readHealth();
    for(const [key,value] of Object.entries(updates))data[key]={ok:Boolean(value.ok),reason:value.ok?'':String(value.reason||'사용 불가').slice(0,40),at:new Date().toISOString()};
    await fs.mkdir(path.dirname(healthFile()),{recursive:true});
    const temp=healthFile()+'.'+process.pid+'.tmp';
    await fs.writeFile(temp,JSON.stringify(data),'utf8');
    await fs.rename(temp,healthFile());
  }catch{}
}
// API 오류 문구 → 사람이 알아볼 이유. 일시 장애(503·시간 초과·모델별 한도)는 null: 빨간색으로 바꾸지 않습니다.
export function apiReason(message){
  const m=String(message||'');
  if(/credit balance|credit_balance|insufficient_quota|no credits|billing/i.test(m))return '크레딧 부족';
  if(/키가 맞지 않거나 권한 없음|HTTP 401|HTTP 403|invalid.?api.?key|API_KEY_INVALID/i.test(m))return '키 오류';
  if(/API 키를 .*설정해 주세요|키가 없습니다/.test(m))return '키 없음';
  return null;
}
