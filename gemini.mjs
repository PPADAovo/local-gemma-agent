// Gemini API adapter. Never starts a CLI or falls back to account login.
import fs from 'node:fs/promises';
import path from 'node:path';
import * as cloud from './cloud-brain.mjs';
export {extractJson} from './cloud-brain.mjs';
export async function status(){return (await cloud.selectedBrain('api-gemini')).status();}
export async function cliStatus(){return {ok:false,message:'API 전용 연결입니다. 내 API 키 등록에서 Gemini 키를 넣어 주세요.'};}
export async function snapshot(dir, max = 6000) {
  const map = new Map(); let n = 0;
  async function walk(d, depth) {
    if (depth > 6 || n > max) return;
    let list; try { list = await fs.readdir(d, {withFileTypes: true}); } catch { return; }
    for (const e of list) {
      if (++n > max) return;
      if (/^(node_modules|\.git|dist|build|\.next|__pycache__|\.venv|venv|복구기록|대화기록|작업로그)$/.test(e.name)) continue;
      const f = path.join(d, e.name);
      if (e.isDirectory()) await walk(f, depth + 1);
      else if (e.isFile()) { try { const st = await fs.stat(f); map.set(f, st.mtimeMs + ':' + st.size); } catch {} }
    }
  }
  await walk(dir, 0); return map;
}


export async function ask(prompt,{cwd,autoApprove=false,onProgress=()=>{},format}={}){
  if(cwd || autoApprove)throw Error('API 전용 모드에서는 CLI 코딩 위임을 사용하지 않습니다. 앱의 read/write/edit 도구로 작업하세요.');
  // API 키가 없으면 로그인해 둔 Gemini 구독(Antigravity CLI)으로 묻습니다. 이때도 Gemini는 답만 하고 파일은 건드리지 않습니다.
  if(!(await status().catch(()=>({ok:false}))).ok){
    const sub=await cloud.selectedBrain('sub-gemini');
    if((await sub.status()).ok){
      const text=await sub.complete([{role:'user',content:prompt}],format,{onProgress});
      return {text,changed:[]};
    }
  }
  const r=await cloud.chat([{role:'user',content:prompt}],{provider:'gemini',onProgress,format});
  return {text:r.text,changed:[]};
}
export async function chatJson(messages,format,options={}){
  return (await cloud.chat(messages,{...options,provider:'gemini',format})).text;
}
export async function complete(messages,format,options={}){return chatJson(messages,format,options);}
