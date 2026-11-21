import {topic,fallback,summarize} from './chat-title.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
const directory=new URL('./대화기록/',import.meta.url);
function location(id){
  if(!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(id))throw Error('잘못된 대화 ID');
  return new URL(id+'.json',directory);
}
export async function loadChat(id){
  try{return JSON.parse(await fs.readFile(location(id),'utf8'));}
  catch(e){if(e.code==='ENOENT')return [];throw e;}
}
let previewBatch;
export async function prepareChatPreviews(id,paths){
  previewBatch=null;
  const pictures=[...new Set(paths.filter(p=>typeof p==='string' && /\.(png|jpe?g|gif|bmp|webp|heic|tiff?)$/i.test(p)))].slice(0,10);
  if(!pictures.length)return;
  location(id);
  const start=(await loadChat(id)).length;
  const media=new URL('./사진/'+id+'/',directory);
  await fs.mkdir(media,{recursive:true});
  const copies=[];
  for(const picture of pictures){
    const dest=new URL(randomUUID()+path.extname(picture).toLowerCase(),media);
    await fs.copyFile(picture,dest);
    copies.push(fileURLToPath(dest));
  }
  previewBatch={id,start,copies};
}
export async function saveChat(id,turns){
  if(turns.at(-1)?.role==='assistant' && !turns.at(-1).createdAt)turns.at(-1).createdAt=new Date().toISOString();
  if(previewBatch?.id===id){
    const turn=turns.slice(previewBatch.start).find(t=>t.role==='user');
    if(turn)turn.previewImages=previewBatch.copies;
  }
  await fs.mkdir(directory,{recursive:true});
  const tmp=new URL(randomUUID()+'.tmp',directory);
  try{
    await fs.writeFile(tmp,JSON.stringify(turns),{flag:'wx',flush:true});
    await fs.rename(tmp,location(id));
  }finally{await fs.rm(tmp,{force:true});}
  await ensureAutoTitle(id,turns).catch(()=>{});
}
export async function ensureAutoTitle(id,turns){
  location(id);
  const source=topic(turns);if(!source || (await metadata(id)).title)return;
  const dir=new URL('titles/',directory),file=new URL(id+'.txt',dir);
  try{await fs.access(file);return;}catch(e){if(e.code!=='ENOENT')throw e;}
  const title=await summarize(source);if(!title)return;
  await fs.mkdir(dir,{recursive:true});await fs.writeFile(file,title,{flag:'wx'});
}
export async function listChats(query=''){
  await fs.mkdir(directory,{recursive:true});
  const files=(await fs.readdir(directory)).filter(f=>f.endsWith('.json'));
  const chats=await Promise.all(files.map(async file=>{
    const id=path.basename(file,'.json');
    const [turns,stat,meta]=await Promise.all([loadChat(id),fs.stat(location(id)),metadata(id)]);
    const title=meta.title || await fs.readFile(new URL('titles/'+id+'.txt',directory),'utf8').catch(()=> '') || fallback(topic(turns));
    const term=query.trim().toLocaleLowerCase();
    const found=term && turns.find(turn=>turn.content.toLocaleLowerCase().includes(term));
    if(term && !found && !title.toLocaleLowerCase().includes(term))return null;
    const start=found?Math.max(0,found.content.toLocaleLowerCase().indexOf(term)-12):0;
    return {id,title,updated:stat.mtimeMs,snippet:found?found.content.slice(start,start+70):'',archived:!!meta.archived,unread:!!meta.unread,section:meta.section||''};
  }));
  return chats.filter(Boolean).sort((a,b)=>b.updated-a.updated);
}
async function metadata(id){
  location(id);
  try{return JSON.parse(await fs.readFile(new URL('meta/'+id+'.json',directory),'utf8'));}
  catch(e){if(e.code==='ENOENT')return {};throw e;}
}
export async function manageChat(id,action,value){
  const source=location(id);
  await fs.access(source);
  const meta=new URL('meta/'+id+'.json',directory);
  if(action==='delete'){await fs.unlink(source);await fs.rm(new URL('titles/'+id+'.txt',directory),{force:true});await fs.rm(meta,{force:true});return {};}
  if(action==='fork'){const copy=randomUUID();await saveChat(copy,await loadChat(id));return {id:copy};}
  if(action==='forkAnswer'){
    const {index,content}=JSON.parse(value),turns=await loadChat(id);
    const answers=turns.map((turn,i)=>turn.role==='assistant'?i:-1).filter(i=>i>=0);
    const end=answers[index];if(!Number.isInteger(index)||end==null||turns[end].content!==content)throw Error('저장된 답변을 확인할 수 없습니다.');
    const copy=randomUUID();await saveChat(copy,turns.slice(0,end+1));return {id:copy};
  }
  if(action==='forkBeforeMessage'){
    const {userIndex,content}=JSON.parse(value);
    if(!Number.isSafeInteger(userIndex)||userIndex<0||typeof content!=='string')throw Error('잘못된 메시지 위치입니다.');
    const turns=await loadChat(id);
    let seen=0;
    const index=turns.findIndex(t=>t.role==='user'&&seen++===userIndex);
    if(index<0||turns[index].content!==content)throw Error('대화가 바뀌었습니다. 대화를 다시 열고 편집해 주세요.');
    const copy=randomUUID();
    await saveChat(copy,turns.slice(0,index));
    return {id:copy};
  }
  if(!['title','archived','unread','section'].includes(action))throw Error('잘못된 채팅 작업');
  const item=await metadata(id);
  item[action]=['archived','unread'].includes(action)?value==='true':String(value).slice(0,160);
  await fs.mkdir(new URL('meta/',directory),{recursive:true});
  const tmp=new URL(randomUUID()+'.tmp',directory);
  try{await fs.writeFile(tmp,JSON.stringify(item),{flag:'wx',flush:true});await fs.rename(tmp,meta);}finally{await fs.rm(tmp,{force:true});}
  return {};
}
