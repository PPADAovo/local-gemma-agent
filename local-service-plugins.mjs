import {appDataDir} from './app-data.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';

const services=[
 ['gmail','Gmail','https://mail.google.com/','메일함 열기','메일 지메일',true],
 ['google-drive','Google Drive','https://drive.google.com/','드라이브 파일 열기','드라이브 파일',true],
 ['google-calendar','Google Calendar','https://calendar.google.com/','캘린더 열기','일정 달력',true],
 ['github','GitHub','https://github.com/','저장소 및 이슈 열기','깃허브',true],
 ['slack','Slack','https://app.slack.com/','Slack 작업 공간 열기','슬랙'],
 ['outlook-email','Outlook Email','https://outlook.office.com/mail/','Outlook 메일함 열기','메일 아웃룩 이메일'],
 ['icloud-mail','iCloud Mail','https://www.icloud.com/mail/','iCloud 메일함 열기','아이클라우드 메일'],
 ['icloud-calendar','iCloud Calendar','https://www.icloud.com/calendar/','iCloud 캘린더 열기','아이클라우드 일정'],
 ['dropbox','Dropbox','https://www.dropbox.com/home','Dropbox 파일 열기','드롭박스'],
 ['hubspot','HubSpot','https://app.hubspot.com/','HubSpot 작업 공간 열기','허브스팟']
].map(([slug,name,url,description,keywords,builtin=false])=>({slug,id:slug,name,url,description,keywords,builtin,detail:description,tool:'local.'+slug+'.open'}));
const dir=()=>path.join(appDataDir(),'local-plugins');
// These registered actions only open a service or observe it; unknown actions still need approval.
export const isLocalReadOnlyTool=name=>services.some(service=>service.tool===name) || name==='local.gmail.important';
async function row(service){
 let state;
 try{state=JSON.parse(await fs.readFile(path.join(dir(),service.slug+'.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;state={installed:service.builtin,enabled:service.builtin};}
 return {...service,...state};
}
// 이 목록의 항목은 '웹사이트를 작업 탭에서 여는 바로가기'입니다. 켜져 있어도 계정이 연결된 것은 아니므로,
// 실제 계정 연결(Codex 앱 서버의 서비스 도구) 여부를 함께 보여 줍니다. 확인 결과는 10분 동안 파일에 저장해 씁니다.
async function realConnections(){
 const file=path.join(dir(),'connection-status.json');
 try{const cached=JSON.parse(await fs.readFile(file,'utf8'));if(Date.now()-cached.at<600000)return cached.status;}catch{}
 try{
  const {connectedServices}=await import('./gemma-plugins.mjs');
  const status=await connectedServices(services.map(s=>s.slug));
  await fs.mkdir(dir(),{recursive:true});await fs.writeFile(file,JSON.stringify({at:Date.now(),status}));
  return status;
 }catch{return null;}
}
export async function localManager({tab,id,action,enable}){
 if(!id){
  const rows=await Promise.all(services.map(row));const real=await realConnections();
  const labeled=rows.map(r=>!real?r:{...r,connected:real[r.slug]===true,
   detail:real[r.slug]?'계정 연결됨 · 에이전트가 메일·파일·일정을 직접 읽고 쓸 수 있음 (이 항목은 웹사이트 바로가기)':'계정 연결 안 됨 · 웹사이트 열기만 가능. 직접 읽고 쓰려면 연결이 필요합니다'});
  return {rows:labeled.filter(r=>tab==='홈'||(tab==='디렉터리'?!r.installed:r.installed))};
 }
 const service=services.find(r=>r.id===id);if(!service)throw Error('등록되지 않은 로컬 서비스입니다.');
 const r=await row(service);
 if(action==='connection')return {url:r.url,available:r.installed&&r.enabled};
 if(action!=='install'&&!(action==='toggle'&&r.installed&&typeof enable==='boolean'))throw Error('지원하지 않는 로컬 플러그인 작업입니다.');
 await fs.mkdir(dir(),{recursive:true});const dest=path.join(dir(),id+'.json'),tmp=dest+'.'+randomUUID();
 try{await fs.writeFile(tmp,JSON.stringify({installed:true,enabled:action==='install'||enable}));await fs.rename(tmp,dest);}finally{await fs.rm(tmp,{force:true});}
 return {ok:true};
}
export async function localTools(query,call){
 if(call){const important=call.name==='local.gmail.important';const service=services.find(s=>s.tool===call.name || (important&&s.slug==='gmail'));if(!service)throw Error('알 수 없는 로컬 도구입니다.');
 const r=await row(service);if(!r.installed||!r.enabled)throw Error('로컬 플러그인을 먼저 추가하고 켜 주세요.');
 const {browser,hasWorkTab,readImportantMail,leaveWorkTabOpen}=await import('./browser.mjs');
 const url=important?'https://mail.google.com/mail/u/0/#imp':r.url;
 if(!await hasWorkTab())throw Error('Chrome 작업 탭 확장을 연결해 주세요.');
 if(important)return readImportantMail(url);
 const result=await browser({tool:'browser_open',text:url});
 await leaveWorkTabOpen();
 process.stderr.write('@worktab keep\n');
 return result;}
 const rows=(await localManager({tab:'플러그인'})).rows.filter(r=>r.enabled);
 const words=query.toLowerCase().trim().split(/\s+/).filter(Boolean);
 if(rows.some(r=>r.slug==='gmail') && /gmail|지메일/.test(query.toLowerCase()) && /important|중요/.test(query.toLowerCase()))return [{name:'local.gmail.important',description:'Gmail 중요 라벨에서 보이는 메일 제목을 조회합니다.',inputSchema:{type:'object',properties:{},additionalProperties:false}}];
 return rows.filter(r=>words.every(w=>(r.tool+' '+r.name+' '+r.description+' '+r.keywords).toLowerCase().includes(w))).map(r=>({name:r.tool,description:r.name+' ('+r.url+') · '+r.description+' · 에이전트 브라우저에서 열고 이후 브라우저 도구로 작업합니다.',inputSchema:{type:'object',properties:{},additionalProperties:false}}));
}
