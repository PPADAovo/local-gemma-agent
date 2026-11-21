// 앱 스크립트 어댑터 모음(app_script 도구).
// 어댑터는 앱마다 얇게 하나씩: 설치 확인(detect) · 코드 검사(check) · 실행(run) · 상태/결과 이미지 보고만 합니다.
// 앱별 "동작 목록"이나 물체 레시피는 넣지 않습니다. 사용법·주의점은 app-adapters/<id>.md 노트에 두고 그 앱을 쓸 때만 보여 줍니다.
// 새 앱을 붙이려면: 이 폴더에 <id>.mjs(어댑터)와 <id>.md(노트)를 만들고 아래 ADAPTERS에 넣으면 됩니다.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import blender from './blender.mjs';
import freecad from './freecad.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
export const ADAPTERS=[blender,freecad];

export function adapterFor(app){
  const text=String(app||'').trim().toLowerCase();
  if(!text)return null;
  return ADAPTERS.find(a=>a.id===text)||ADAPTERS.find(a=>a.match.test(text))||null;
}
// 요청 글에 이름이 나온 어댑터.
export const adaptersMentioned=text=>ADAPTERS.filter(a=>a.match.test(String(text||'')));

// 이 PC에 설치된 어댑터(실행 파일 경로 포함). 한 프로세스 안에서는 한 번만 찾습니다.
let installedCache=null;
export async function installedAdapters(){
  installedCache??=Promise.all(ADAPTERS.map(async a=>({adapter:a,exe:await a.detect().catch(()=>null)})))
    .then(rows=>rows.filter(r=>r.exe));
  return installedCache;
}
export const describeAdapter=a=>a.id+'('+a.name+', '+a.language+(a.kind==='3d'?', 3D/CAD':'')+')';

export async function adapterNote(id){
  return fs.readFile(path.join(here,id+'.md'),'utf8').then(t=>t.trim(),()=> '');
}

// 반환(모든 어댑터 공통): {ok, report, image(base64|''), files:[실제 존재하는 산출물 경로], document, state:[물체/항목], warnings, live, before}
export async function runAppScript({app,code,mode='live',name,outDir,size=512}){
  const adapter=adapterFor(app);
  const names=ADAPTERS.map(a=>a.id).join(', ');
  if(!adapter)throw Error('"'+app+'"은(는) 스크립트 어댑터가 없는 앱입니다. 이 앱은 화면 조작(look → click/key/type)으로 하세요. 스크립트 가능한 앱: '+names);
  const found=(await installedAdapters()).find(r=>r.adapter===adapter);
  if(!found)throw Error(adapter.name+'이(가) 이 PC에 설치돼 있지 않습니다. 설치가 필요하면 사용자에게 먼저 물어보세요(user_action). 다른 설치된 앱이나 화면 조작으로 할 수 있으면 그렇게 하세요.');
  const blocked=adapter.check(code);
  if(blocked)throw Error(blocked);
  return adapter.run({exe:found.exe,code:String(code||''),mode,name,outDir:path.join(outDir,adapter.name),size});
}
