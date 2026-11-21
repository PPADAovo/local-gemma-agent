// Gemini 구독 연결: Google AI Pro 계정으로 로그인한 Antigravity CLI(agy)를 불러 씁니다(API 요금 없음, 구독 한도 적용).
// 설치·로그인은 앱 폴더의 "제미나이-연결.cmd"로 합니다. '제미나이설정.json'에 {"model":"..."}을 넣으면 모델을 고정합니다.
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {extractJson} from './cloud-brain.mjs';
import {sessionComplete,utilityComplete} from './gemini-session.mjs';
import {usableModels,markExhausted,isQuotaError,quotaNote} from './gemini-quota.mjs';
import {watchModelProcess} from './model-process-lifecycle.mjs';

const CONFIG=fileURLToPath(new URL('./제미나이설정.json',import.meta.url));
async function config(){try{return JSON.parse((await fs.readFile(CONFIG,'utf8')).replace(/^﻿/,''));}catch{return {};}}
function findAgy(){
  const dirs=[...(process.env.PATH||'').split(path.delimiter),path.join(process.env.LOCALAPPDATA||'','Antigravity'),path.join(process.env.LOCALAPPDATA||'','Antigravity','bin'),path.join(os.homedir(),'.gemini','bin'),path.join(os.homedir(),'.local','bin'),path.join(process.env.APPDATA||'','npm')];
  for(const d of dirs)for(const e of ['.exe','.cmd','.bat',''])if(d){const f=path.join(d,'agy'+e);try{if(fsSync.statSync(f).isFile())return f;}catch{}}
  return null;
}
export async function status(){
  return findAgy()?{ok:true}:{ok:false,message:'Gemini 구독 연결 도구(Antigravity CLI, agy)가 설치돼 있지 않습니다. 앱 폴더의 "제미나이-연결.cmd"를 실행해 설치하고 AI Pro 계정으로 로그인하세요.'};
}
function runAgy(exe,args,{onProgress,deadline,signal}){
  return new Promise((resolve,reject)=>{
    const isCmd=/\.(cmd|bat)$/i.test(exe);
    if(isCmd && [exe,...args].some(v=>/["&|<>^%!\r\n]/.test(v)))return reject(Error('Gemini 실행 경로 또는 옵션에 지원하지 않는 문자가 있습니다.'));
    const line=isCmd?'"'+[exe,...args].map(v=>'"'+v+'"').join(' ')+'"':'';
    signal?.throwIfAborted();
    const left=Math.min(240000,Number.isFinite(deadline)?deadline-Date.now():240000);
    if(left<=0)return reject(Object.assign(Error('작업 시간 제한에 도달했습니다.'),{code:'TASK_DEADLINE'}));
    const child=spawn(isCmd?'cmd.exe':exe,isCmd?['/d','/s','/c',line]:args,{windowsVerbatimArguments:isCmd,cwd:os.tmpdir(),windowsHide:true,env:{...process.env,NO_COLOR:'1',FORCE_COLOR:'0'}});
    child.stdin.on('error',()=>{});child.stdin.end();
    let out='',err='';const started=Date.now();
    onProgress('Gemini 구독 · 응답을 기다리는 중 (0초)');
    const tick=setInterval(()=>onProgress('Gemini 구독 · 응답을 기다리는 중 ('+Math.round((Date.now()-started)/1000)+'초)'),5000);
    const guard=watchModelProcess(child,{deadline,signal},left,error=>{clearInterval(tick);reject(error);});
    child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
    child.stdout.on('data',d=>{out+=d;});child.stderr.on('data',d=>{err+=d;});
    child.on('error',e=>{guard.dispose();clearInterval(tick);reject(guard.error||e);});
    child.on('close',code=>{
      guard.dispose();clearInterval(tick);if(guard.error)return reject(guard.error);
      const clean=s=>s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g,'').trim();
      if(code!==0){
        const msg=clean(err)||clean(out);
        if(/login|sign.?in|auth|credential|로그인/i.test(msg))return reject(Error('Gemini 구독 로그인이 필요합니다. "제미나이-연결.cmd"를 실행해 Google 계정으로 로그인하세요.'));
        if(/quota|rate|limit|429|exhausted/i.test(msg))return reject(Error('Gemini 구독 사용 한도에 걸렸습니다. 잠시 뒤 다시 하세요.'));
        return reject(Error('Gemini 구독 실행 실패 (종료 코드 '+code+'): '+msg.slice(-400)));
      }
      resolve(clean(out));
    });
  });
}
// 한도가 찬 모델은 건너뛰고 다음 모델로 같은 요청을 다시 보냅니다(gemini-quota.mjs).
export async function complete(messages,format,options={}){
  const c=await config();
  const preferred=typeof c.model==='string'&&/^[\w.-]+$/.test(c.model)?c.model:'';
  let last;
  for(const model of usableModels(preferred)){
    try{return await completeWith(messages,format,{...options,model});}
    catch(error){
      if(!isQuotaError(error.message))throw error;
      markExhausted(model,error.message);last=error;
      options.onProgress?.('Gemini 구독 · '+(model||'기본 모델')+' 사용 한도가 차서 다른 모델로 바꿉니다.');
    }
  }
  throw Error('Gemini 구독의 모든 모델이 사용 한도에 걸렸습니다. '+(quotaNote()||'')+(last?' ('+String(last.message).slice(0,160)+')':''));
}
async function completeWith(messages,format,{onProgress=()=>{},model='',deadline,signal}={}){
  signal?.throwIfAborted();
  const exe=findAgy();if(!exe)throw Error((await status()).message);
  const c={...(await config()),model};
  // Headless text prompts do not attach @image paths. ACP is the documented
  // multimodal protocol and sends actual base64 content blocks instead.
  if(messages.some(message=>Array.isArray(message.images)&&message.images.length)){
    const {acpComplete}=await import('./gemini-acp.mjs');
    return acpComplete(messages,format,{exe,model,onProgress,deadline,signal});
  }
  // 에이전트의 "다음 행동 판단"(tool 칸이 있는 형식)은 같은 대화가 단계마다 이어집니다. CLI를 켜 둔 세션으로 새 내용만 보내
  // 한 단계를 몇 초로 줄입니다. 세션이 실패하면 아래의 한 번씩 묻는 방식으로 이어서 처리합니다.
  if(format?.properties?.tool && !/\.(cmd|bat)$/i.test(exe) && c.session!==false){
    try{return await sessionComplete(messages,format,{exe,model:typeof c.model==='string'&&/^[\w.-]+$/.test(c.model)?c.model:'',onProgress,deadline,signal});}
    catch(error){if(signal?.aborted||error.code==='TASK_DEADLINE'||/로그인|한도/.test(error.message)||isQuotaError(error.message))throw error;onProgress('Gemini 구독 · 세션 대신 일반 방식으로 다시 묻는 중 ('+String(error.message).slice(0,160)+')');}
  }
  // 그 밖의 호출(작업 명세, 완료 검증, 요약 등)도 켜 둔 보조 세션으로 보냅니다. 실패하면 아래의 한 번씩 묻는 방식으로 넘어갑니다.
  else if(!/\.(cmd|bat)$/i.test(exe) && c.session!==false){
    try{return await utilityComplete(messages,format,{exe,model:typeof c.model==='string'&&/^[\w.-]+$/.test(c.model)?c.model:'',onProgress,deadline,signal});}
    catch(error){if(signal?.aborted||error.code==='TASK_DEADLINE'||/로그인|한도/.test(error.message)||isQuotaError(error.message))throw error;onProgress('Gemini 구독 · 세션 대신 일반 방식으로 다시 묻는 중 ('+String(error.message).slice(0,160)+')');}
  }
  const id=crypto.randomUUID(),dir=os.tmpdir(),tmp=[];
  try{
    const system=messages.filter(m=>m.role==='system').map(m=>m.content).join('\n\n');
    // The caller fits conversation context. This transport must not silently
    // discard requirements or the beginning of a file; long requests use @file.
    const convo=messages.filter(m=>m.role!=='system').map(m=>(m.role==='assistant'?'[YOU (previous)]\n':'[USER/TOOL RESULT]\n')+String(m.content??'')).join('\n\n');
    const schema=format||{type:'object',properties:{answer:{type:'string'}},required:['answer']};
    const prompt=(system?'[SYSTEM INSTRUCTIONS]\n'+system+'\n\n':'')+'[CONVERSATION]\n'+convo+'\n\n[YOUR TASK NOW]\nWrite the next assistant response. Do not invoke tools or edit files.'+(format?' Fill each field of the structured output directly (never put JSON text inside a field):\n'+JSON.stringify(format):' Put your plain reply text in the answer field.');
    const promptFile=path.join(dir,'gemma-prompt-'+id+'.txt'),schemaFile=path.join(dir,'gemma-schema-'+id+'.json');
    tmp.push(promptFile,schemaFile);
    await fs.writeFile(promptFile,prompt,'utf8');await fs.writeFile(schemaFile,JSON.stringify(schema),'utf8');
    // agy는 표준 입력을 받지 않습니다. 실행 파일이고 명령줄 제한(32,767자)보다 짧으면 바로 넘기고(빠름),
    // 길거나 .cmd라면 파일 경로(@)로 넘깁니다(모델이 파일을 여는 단계가 하나 늘어 느림).
    const inline=!/\.(cmd|bat)$/i.test(exe)&&prompt.length<24000;
    const args=[...(typeof c.model==='string'&&/^[\w.-]+$/.test(c.model)?['--model',c.model]:[]),'--output-format','json','--json-schema',schemaFile,'-p',inline?prompt:'Read the complete request in @'+promptFile];
    const out=await runAgy(exe,args,{onProgress,deadline,signal});
    let value;
    try{const env=JSON.parse(out);if(env.status&&env.status!=='SUCCESS')throw Error('Gemini 구독 요청 실패: '+String(env.error||env.status).slice(0,300));value=env.structured_output??extractJson(String(env.response||''));}
    catch(e){if(/요청 실패/.test(e.message))throw e;value=extractJson(out);}
    if(!value||typeof value!=='object')throw Error('Gemini 구독 응답에서 JSON을 찾지 못했습니다: '+out.slice(0,200));
    // 칸 하나에 같은 모양의 JSON 글자를 한 번 더 넣어 보낸 경우 풀어냅니다.
    const keys=Object.keys(value);
    if(keys.length===1&&typeof value[keys[0]]==='string'){const inner=extractJson(value[keys[0]]);if(inner&&keys.every(k=>k in inner))value=inner;}
    if(format)return JSON.stringify(value);
    if(typeof value.answer!=='string'||!value.answer.trim())throw Error('Gemini 구독이 빈 답변을 보냈습니다.');
    return value.answer;
  }finally{for(const f of tmp)await fs.unlink(f).catch(()=>{});}
}
