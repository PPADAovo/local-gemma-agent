// 앱별 사용 경로 메모: 에이전트가 어떤 앱에서 일을 끝낸 방법(어느 탭·버튼을 거쳤는지)을 스스로 적어 두고,
// 다음에 같은 앱을 다룰 때 먼저 읽습니다. 앱마다 스킬을 미리 만들어 둘 필요가 없게 하려는 장치입니다.
// 큰 모델이 찾아낸 길을 작은 모델이 그대로 따라갈 수 있어서, 모델을 섞어 쓸 때 특히 도움이 됩니다.
//   앱지식/<프로그램>.md      앱과 함께 배포되는 기본 지식(새로 설치한 사람도 받음). 에이전트는 읽기만 합니다.
//   기억/앱/<프로그램>.md     이 PC에서 배운 메모. 에이전트가 쓰고, 사람이 직접 고쳐도 됩니다.
// 배운 메모를 다른 사람에게도 주려면 그 파일을 앱지식 폴더로 옮기면 됩니다(개인 내용이 없는지 확인한 뒤).
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {redactPasswords} from './secrets.mjs';

const bundledDir=fileURLToPath(new URL('./앱지식/',import.meta.url));
const learnedDir=fileURLToPath(new URL('./기억/앱/',import.meta.url));
const MAX_ENTRIES=15;

// 프로그램 이름만 파일 이름으로 씁니다(경로 문자가 섞이지 않게).
export const appKey=process=>String(process??'').trim().replace(/\.exe$/i,'').replace(/[^\p{L}\p{N} ._-]/gu,'').slice(0,60);
const clean=(text,limit)=>redactPasswords(String(text??'')).replace(/\s+/g,' ').trim().slice(0,limit);
const taskKey=task=>String(task).toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
const entryLine=/^- (?:\[(\d{4}-\d{2}-\d{2})\] )?(.+?) ⇒ (.+)$/;

async function entries(file){
  const text=await fs.readFile(file,'utf8').catch(()=> '');
  return text.split(/\r?\n/).map(line=>line.match(entryLine)).filter(Boolean).map(m=>({date:m[1]||'',task:m[2],route:m[3]}));
}

// 모델에게 보여 줄 메모: 기본 지식 다음에 이 PC에서 배운 것. 같은 일은 배운 쪽(더 최근)을 씁니다.
export async function readAppNotes(process,{bundled=bundledDir,learned=learnedDir,limit=1800}={}){
  const key=appKey(process);
  if(!key)return '';
  const mine=await entries(path.join(learned,key+'.md'));
  const known=new Set(mine.map(e=>taskKey(e.task)));
  const base=(await entries(path.join(bundled,key+'.md'))).filter(e=>!known.has(taskKey(e.task)));
  return [...base,...mine].map(e=>'- '+e.task+' ⇒ '+e.route).join('\n').slice(0,limit);
}

// 배운 길 하나를 저장합니다. 같은 일에 대한 메모는 새 것으로 바꿉니다.
export async function saveAppNote(process,{task,route},{learned=learnedDir,date=new Date().toISOString().slice(0,10)}={}){
  const key=appKey(process);
  const entry={date,task:clean(task,90),route:clean(route,500)};
  if(!key || entry.task.length<2 || entry.route.length<4)return false;
  const file=path.join(learned,key+'.md');
  const kept=(await entries(file)).filter(e=>taskKey(e.task)!==taskKey(entry.task)).slice(-(MAX_ENTRIES-1));
  await fs.mkdir(learned,{recursive:true});
  await fs.writeFile(file,'# '+key+' 사용 메모\n\n에이전트가 이 앱에서 일을 끝낸 방법입니다. 직접 고치거나 지워도 됩니다.\n\n'+
    [...kept,entry].map(e=>'- '+(e.date?'['+e.date+'] ':'')+e.task+' ⇒ '+e.route).join('\n')+'\n');
  return true;
}

// 실제로 성공한 조작 순서를 한 줄 경로로 만듭니다. 입력한 글(메시지 내용 등)은 적지 않습니다.
export function routeFromSteps(steps){
  const words={click:'클릭',double_click:'두 번 클릭',right_click:'오른쪽 클릭',key:'키',scroll:'스크롤',open_app:'앱 열기',unlock_app:'잠금 해제'};
  const out=[];
  for(const step of steps||[]){
    let part='';
    if(step.tool==='type')part='글자 입력';
    else if(words[step.tool]){
      const name=clean(step.name||(['key','scroll','open_app'].includes(step.tool)?step.text:'')||'',30);
      part=words[step.tool]+(name?' «'+name+'»':step.tool.endsWith('click')?' (글자 없는 위치)':'');
    }
    if(part && out.at(-1)!==part)out.push(part);
  }
  return out.slice(-14).join(' → ');
}

// 사용자가 작업 중에 알려 준 길 안내인지("프로필 눌러서 나와의 채팅 들어가" 등)
export const looksLikeRouteHint=text=>/(?:탭|메뉴|버튼|아이콘|프로필|목록|설정|창)/.test(String(text??'')) &&
  /(?:눌러|누르|클릭|들어가|열어|선택|이동|스크롤)/.test(String(text??''));

// 성공한 작업에서 다음에 쓸 메모를 만듭니다. 모델에게 한 줄로 정리하게 하고, 실패하면 조작 순서를 그대로 씁니다.
export async function summarizeRoute({chat,goal,steps,hints=[]}){
  const raw=routeFromSteps(steps);
  if(!raw)return null;
  const fallback={task:clean(goal,90),route:raw};
  if(!chat)return fallback;
  try{
    const schema={type:'object',properties:{task:{type:'string'},route:{type:'string'}},required:['task','route']};
    const made=JSON.parse(await chat([{role:'system',content:'An agent just finished a task in a desktop app. Write a reusable note for next time, in Korean. task = the kind of job in general words, at most 40 characters, without names, dates or message contents. route = the working path through the app as short steps joined by " → ": which tab, icon, list item or button to use, in order. Keep only steps that were needed; drop detours, retries and failed attempts. Describe where things are (e.g. "왼쪽 위 사람 모양 아이콘"), not coordinates. Never include passwords, message text, or personal data.'},
      {role:'user',content:JSON.stringify({goal,performed:raw,userHints:hints.slice(-4)})}],schema,{direct:true}));
    const note={task:clean(made.task,90),route:clean(made.route,500)};
    return note.task.length>=2 && note.route.length>=4?note:fallback;
  }catch{return fallback;}
}
