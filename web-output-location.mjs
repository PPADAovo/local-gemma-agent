import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const WEB_OUTPUT_GUIDE='웹페이지를 새로 만드는 요청은 저장 위치를 먼저 사용자에게 묻고, 선택한 폴더 안의 새 작업 폴더에 새 파일로 만듭니다. 기존 결과물을 이동하거나 덮어써서 새 결과물로 대신하지 마세요. 위치 질문은 실행기가 처리합니다. 새 웹 파일은 write/edit 도구로 저장하세요.';
export function isFileTransferOnly(request){
 const text=String(request||'');
 return /(?:옮기|옮겨|이동|복사|\bmove\b|\bcopy\b|\brename\b)/i.test(text)&&!/(?:수정|고쳐|고치|디자인|꾸며|편집|\bedit\b|\bfix\b|\bredesign\b)|(?:그림|이미지|사진|image|picture).{0,25}(?:생성|그려|만들|generate|create)/i.test(text);
}
export function isWebCreation(request){
 const text=String(request||'');
 if(/(?:옮기|옮겨|이동|복사|\bmove\b|\bcopy\b|\brename\b)/i.test(text))return false;
 if(/(?:수정|고쳐|고치|개선|변경|다듬|버그|\bfix\b|\bedit\b)/i.test(text)&&!/(?:새로|새\s*(?:파일|페이지|사이트)|별도)/i.test(text))return false;
 return /(?:웹|홈페이지|사이트|검색창|랜딩|\.html?\b|\bhtml\b|website|webpage)/i.test(text)&&/(?:만들|제작|생성|구현|작성|\bbuild\b|\bcreate\b)/i.test(text);
}
export function createWebOutputLocation({request,root=process.cwd(),askUser,progress=()=>{}}){
 let required=isWebCreation(request);
 const base=path.resolve(root),mapped=new Map();
 const inferredCreation=/(?:만들|제작|생성|구현|작성|\bbuild\b|\bcreate\b)/i.test(request||'')&&!isFileTransferOnly(request)&&!/(?:수정|고쳐|고치|개선|변경|편집|\bedit\b|\bfix\b)/i.test(request||'');
 let directory='',selection,created=false,origin=base;
 const mutations=new Set(['write','edit','delete','rename','restore','canvas','generate_image','photo_save','photo_cutout','photo_background','media_convert']);
 const commands=new Set(['run','run_js','gemini_code','delegate']);
 async function choose(){
  const question='새 웹페이지를 어느 폴더에 만들까요? 선택한 위치 안에 새 작업 폴더를 만들어 저장합니다. 폴더 경로를 입력하거나 아래에서 골라 주세요.';
  if(!askUser)throw Object.assign(Error(question),{code:'WEB_LOCATION_REQUIRED'});
  for(let attempt=0;attempt<3;attempt++){
   const answer=await askUser({kind:'question',title:'새 웹페이지 저장 위치',question,options:['바탕화면','문서','현재 작업 폴더','작업 중지']});
   if(!answer||/^(?:작업 중지|취소)$/.test(answer))throw Object.assign(Error('저장 위치 선택을 취소해 파일을 만들지 않았습니다.'),{code:'USER_HANDOFF_STOP'});
   const aliases={'바탕화면':path.join(os.homedir(),'Desktop'),'문서':path.join(os.homedir(),'Documents'),'현재 작업 폴더':base};
   const value=aliases[answer]||String(answer).trim().replace(/^["']|["']$/g,'');
   if(!path.isAbsolute(value)){progress('폴더의 전체 경로를 입력해 주세요.');continue;}
   const folder=path.resolve(value);const stat=await fs.stat(folder).catch(()=>null);
   if(stat&&!stat.isDirectory()){progress('파일이 아닌 폴더를 선택해 주세요.');continue;}
   await fs.mkdir(folder,{recursive:true});
   directory=await fs.mkdtemp(path.join(folder,'새-웹페이지-'));
   progress('새 웹페이지 저장 위치 · '+directory);return directory;
  }
  throw Object.assign(Error('새 웹페이지를 저장할 폴더의 전체 경로가 필요합니다.'),{code:'WEB_LOCATION_REQUIRED'});
 }
 const inside=(parent,file)=>{const rel=path.relative(parent,file);return rel!== '..'&&!rel.startsWith('..'+path.sep)&&!path.isAbsolute(rel);};
 async function prepare(action){
  if(!required&&inferredCreation&&(action.tool==='canvas'||mutations.has(action.tool)&&/\.(?:html?|css|tsx|jsx|vue|svelte)$/i.test(action.path||'')||commands.has(action.tool)&&/\.(?:html?|css)\b/i.test(action.text||'')))required=true;
  if(!required)return;
  if(!directory&&(mutations.has(action.tool)||commands.has(action.tool)))await (selection??=choose());
  if(!directory)return;
  if(commands.has(action.tool))throw Error('새 웹페이지는 기존 파일을 옮기거나 명령으로 덮어쓰지 않습니다. write/edit 도구로 '+directory+' 안에 새 파일을 만드세요.');
  if(!action.path&&action.tool!=='canvas')return;
  if(action.tool==='canvas'){action.tool='write';action.path=String(action.path||'index').replace(/\.html?$/i,'')+'.html';}
  const source=path.resolve(base,action.path);
  if(inside(directory,source))return;
  if(!mapped.size&&path.isAbsolute(action.path)&&mutations.has(action.tool))origin=path.dirname(source);
  let rel=path.relative(origin,source);
  if(!inside(origin,source))rel=path.basename(source);
  const destination=path.resolve(directory,rel);
  if(!inside(directory,destination))throw Error('선택한 새 작업 폴더 밖에는 저장하지 않습니다.');
  const exists=await fs.stat(destination).then(()=>true,()=>false);
  if(mutations.has(action.tool)||mapped.has(source)||exists){
   mapped.set(source,destination);action.path=destination;
   if(action.tool==='write')await fs.mkdir(path.dirname(destination),{recursive:true});
  }
 }
 return {prepare,get directory(){return directory;},get gap(){return required&&!created?'새 웹페이지 파일을 아직 만들지 않았습니다. 저장 위치를 확인한 뒤 write 도구로 새 HTML을 만드세요.':'';},wrap(execute){return async action=>{
  await prepare(action);const result=await execute(action);
  if(directory&&action.tool==='write'&&/\.html?$/i.test(action.path||'')&&inside(directory,path.resolve(action.path)))created=true;
  return result;
 };}};
}
