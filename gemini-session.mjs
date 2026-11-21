// Gemini 구독(Antigravity CLI, agy)을 "계속 켜 둔 대화"로 쓰는 연결입니다.
// 단계마다 CLI를 새로 띄우면 한 번에 12~30초(긴 지시문은 몇 분)가 걸립니다. 이 모듈은 CLI 하나를 켜 둔 채
// 새로 생긴 내용만 보내서 한 단계를 몇 초로 줄입니다. 에이전트의 "다음 행동 판단"처럼 같은 대화가 이어지는 호출에 씁니다.
// - Gemini는 판단만 합니다. 파일·화면·터미널은 앱의 도구와 승인 절차를 거쳐서만 움직입니다(CLI 자체 도구는 쓰지 말라고 지시).
// - 대화 앞부분이 바뀌면(압축 등) 세션을 새로 시작해 전체를 다시 보냅니다.
import fs from 'node:fs/promises';
import {writeFileSync,unlinkSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {extractJson} from './cloud-brain.mjs';
import {stopModelProcess,stopModelProcessSync} from './model-process-lifecycle.mjs';

const hash=value=>crypto.createHash('sha1').update(String(value)).digest('hex');
const imageHash=m=>Array.isArray(m.images)?m.images.map(hash).join(':'):'';
const messageHash=m=>hash(m.role+'\n'+String(m.content??'')+'\n'+imageHash(m));
const TURN_TIMEOUT=240000;

function requireTextOnly(messages){
  if(messages.some(message=>Array.isArray(message.images)&&message.images.length))throw Object.assign(Error('Gemini headless는 텍스트 전용입니다. 이미지 요청에는 gemini-account의 ACP 연결을 사용하세요.'),{code:'VISION_UNSUPPORTED'});
}

// 세션 하나: CLI 프로세스, 이미 보낸 메시지들의 지문, 마지막으로 받은 답
function startSession({exe,model,schemaFile='',spawnProcess=spawn}){
  const args=[...(model?['--model',model]:[]),'--input-format','stream-json','--output-format','stream-json',...(schemaFile?['--json-schema',schemaFile]:[]),'-p='];
  const child=spawnProcess(exe,args,{cwd:os.tmpdir(),windowsHide:true,env:{...process.env,NO_COLOR:'1',FORCE_COLOR:'0'}});
  const session={child,schemaFile,sent:[],lastReply:'',closed:false,waiting:null,buffer:'',errors:''};
  session.ready=new Promise((resolve,reject)=>{session.onInit=resolve;session.onInitFail=reject;});
  session.ready.catch(()=>{});
  const initTimer=setTimeout(()=>{
    fail(Error('Gemini 구독 세션 시작이 30초 안에 완료되지 않았습니다.'));
    void stopModelProcess(child);
  },30000);
  const fail=error=>{
    if(session.closed)return;
    session.closed=true;
    clearTimeout(initTimer);
    session.onInitFail(error);
    if(session.waiting){const w=session.waiting;session.waiting=null;clearTimeout(w.timer);w.reject(error);}
  };
  child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
  child.stdout.on('data',chunk=>{
    session.buffer+=chunk;
    let at;
    while((at=session.buffer.indexOf('\n'))>=0){
      const line=session.buffer.slice(0,at).trim();session.buffer=session.buffer.slice(at+1);
      if(!line)continue;
      let event;try{event=JSON.parse(line);}catch{continue;}
      if(event.event==='init'){clearTimeout(initTimer);session.onInit();}
      else if(event.event==='result' && session.waiting){
        const w=session.waiting;session.waiting=null;clearTimeout(w.timer);
        const r=event.result||{};
        if(r.status && r.status!=='SUCCESS')w.reject(Error('Gemini 구독 요청 실패: '+String(r.error||r.status).slice(0,300)));
        else w.resolve(r.structured_output&&typeof r.structured_output==='object'?JSON.stringify(r.structured_output):String(r.response??''));
      }
    }
  });
  child.stderr.on('data',chunk=>{session.errors=(session.errors+chunk).slice(-2000);});
  child.stdin.on('error',()=>{});
  child.on('error',error=>fail(error));
  child.on('close',code=>fail(Error(sessionError(session.errors)||'Gemini 구독 세션이 끝났습니다 (종료 코드 '+code+').')));
  // 답을 기다리는 동안에는 이 프로세스가 끝나지 않게 붙들고(hold), 쉬는 동안에는 CLI 때문에 살아 있지 않게 놓습니다(release).
  const each=method=>{for(const handle of [child,child.stdout,child.stderr,child.stdin])try{handle?.[method]?.();}catch{}};
  session.hold=()=>each('ref');session.release=()=>each('unref');
  session.close=(error=Error('Gemini 구독 세션이 닫혔습니다.'))=>{clearTimeout(initTimer);if(!session.closed){fail(error);try{child.stdin.end();}catch{}void stopModelProcess(child);}};
  return session;
}
function bindBudget(session,{deadline,signal}){
  const abort=()=>session.close(signal?.reason||Object.assign(Error('작업 시간 제한에 도달했습니다.'),{code:'TASK_DEADLINE'}));
  let timer;if(Number.isFinite(deadline))timer=setTimeout(abort,Math.max(0,deadline-Date.now()));
  signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  return ()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);};
}
function sessionError(text){
  const msg=String(text||'').replace(/\x1b\[[0-9;?]*[A-Za-z]/g,'').trim();
  if(!msg)return '';
  if(/login|sign.?in|auth|credential|로그인/i.test(msg))return 'Gemini 구독 로그인이 필요합니다. "제미나이-연결.cmd"를 실행해 Google 계정으로 로그인하세요.';
  if(/quota|rate|limit|429|exhausted/i.test(msg))return 'Gemini 구독 사용 한도에 걸렸습니다. 잠시 뒤 다시 하세요.';
  return 'Gemini 구독 세션 오류: '+msg.slice(-300);
}
// 모델이 답 대신 자기 도구(함수)를 부르려다 형식이 깨지면 CLI가 오류를 돌려줍니다. 세션은 살아 있으므로 한 번 다시 묻습니다.
async function askTurn(session,text){
  try{return await sendTurn(session,text);}
  catch(error){
    if(session.closed || !/function call|tool call/i.test(error.message))throw error;
    return sendTurn(session,'Do not call any function or tool. Answer again as plain text only: exactly one JSON object matching the schema (or plain text if no schema was given).');
  }
}
function sendTurn(session,text){
  return new Promise((resolve,reject)=>{
    if(session.closed)return reject(Error('Gemini 구독 세션이 닫혀 있습니다.'));
    const timer=setTimeout(()=>{session.waiting=null;session.close();reject(Error('Gemini 구독 응답이 4분 안에 오지 않아 중단했습니다.'));},TURN_TIMEOUT);
    session.waiting={resolve,reject,timer};
    session.child.stdin.write(JSON.stringify({event:'user',message:{role:'user',content:text}})+'\n');
  });
}

const RULES='You are the decision model inside another agent program. That program owns every tool: it reads and writes files, runs commands, opens sites and controls the screen through its own approval system, and reports each result back to you. Never use your own tools, never edit files or run commands yourself, and do not explore the workspace. Each time, answer with exactly one JSON object that matches the given schema and nothing else (no prose, no code fence).';

// 이번에 보낼 글을 만듭니다. first=true면 지시문과 대화 전체, 아니면 새로 생긴 메시지만.
export function buildTurn({messages,from,format,lastReply=''}){
  requireTextOnly(messages);
  const first=from===0;
  const system=messages.filter(m=>m.role==='system');
  const parts=[];
  if(first){
    parts.push('[HOW YOU ARE USED]\n'+RULES);
    if(system.length)parts.push('[SYSTEM INSTRUCTIONS]\n'+system.map(m=>m.content).join('\n\n'));
    if(format)parts.push('[JSON SCHEMA FOR EVERY ANSWER]\n'+JSON.stringify(format));
  }
  const body=[];
  for(let messageIndex=from;messageIndex<messages.length;messageIndex++){
    const m=messages[messageIndex];
    if(first&&m.role==='system')continue;
    const text=String(m.content??'');
    // 방금 내가 한 답을 프로그램이 대화에 그대로 붙인 것은 이미 알고 있으므로 다시 보내지 않습니다.
    if(m.role==='assistant' && lastReply && text.trim()===lastReply.trim())continue;
    body.push((m.role==='assistant'?'[YOUR EARLIER ANSWER, AS RECORDED BY THE PROGRAM]\n':m.role==='system'?'[PROGRAM NOTE]\n':'[USER / TOOL RESULT]\n')+text);
  }
  parts.push((first?'[CONVERSATION]\n':'[NEW SINCE YOUR LAST ANSWER]\n')+(body.join('\n\n')||'(no new message)'));
  parts.push('[YOUR TASK NOW]\nWrite the next answer as text: one JSON object matching the schema, inside a ```json code block. The "tool" value is only a word inside that JSON for the program to read. Do NOT make a function call or use any tool yourself.');
  return parts.join('\n\n');
}

let current=null;
function closeAtExit(session){if(!session)return;if(!session.closed)stopModelProcessSync(session.child);if(session.schemaFile)try{unlinkSync(session.schemaFile);}catch{}}
process.on('exit',()=>closeAtExit(current));

// messages 전체와 형식을 받아 다음 답(JSON 글자)을 돌려줍니다. 같은 대화가 이어지면 새 부분만 보냅니다.
export async function sessionComplete(messages,format,{exe,model='',onProgress=()=>{},spawnProcess,log=()=>{},deadline,signal}={}){
  signal?.throwIfAborted();
  requireTextOnly(messages);
  if(!exe)throw Error('Gemini 구독 연결 도구(agy)를 찾지 못했습니다.');
  const hashes=messages.map(messageHash);
  // 압축된 도구 결과는 세션을 재사용하지만 시스템 지시문과 보존할 사용자 문맥이 바뀌면 다시 전달합니다.
  const instructions=messages.filter(m=>m.role==='system'||m.keep).map(messageHash);
  const key=hash(JSON.stringify(format||null)+'\n'+model+'\n'+JSON.stringify(instructions));
  let session=current;
  // 지난번에 보낸 마지막 메시지가 지금 대화의 어디에 있는지 찾아, 그 뒤만 보냅니다. 앞쪽 메시지가 줄어들거나(정리)
  // 요약으로 합쳐져도 Gemini는 원문을 이미 봤으므로 세션을 그대로 씁니다. 마지막 메시지를 못 찾을 때만 새로 엽니다.
  const resumeAt=session && !session.closed && session.key===key && session.lastSent?hashes.lastIndexOf(session.lastSent)+1:0;
  const continues=resumeAt>0;
  const previousSent=session?.sent||[];
  if(!continues){
    session?.close();
    const schemaFile=format?path.join(os.tmpdir(),'gemma-policy-schema-'+crypto.randomUUID()+'.json'):'';
    if(schemaFile)writeFileSync(schemaFile,JSON.stringify(format),'utf8');
    session=current=startSession({exe,model,schemaFile,spawnProcess});
    if(schemaFile){const closeSession=session.close;session.close=error=>{closeSession(error);fs.unlink(schemaFile).catch(()=>{});};}
    session.key=key;session.sent=[];session.lastSent='';
    const changedAt=current&&session.key===key?hashes.findIndex((h,i)=>previousSent[i]!==undefined&&previousSent[i]!==h):-1;
    onProgress('Gemini 구독 · 판단 세션을 여는 중'+(changedAt>=0?' (대화 '+(changedAt+1)+'번째 메시지가 바뀜)':''));
  }
  const started=Date.now();
  const tick=setInterval(()=>onProgress('Gemini 구독 · 판단을 기다리는 중 ('+Math.round((Date.now()-started)/1000)+'초)'),5000);
  tick.unref?.();
  session.hold();
  const clearBudget=bindBudget(session,{deadline,signal});
  try{
    await session.ready;
    const from=continues?resumeAt:0;
    const text=buildTurn({messages,from,format,lastReply:session.lastReply});
    let reply=await askTurn(session,text);
    let value=extractJson(reply);
    if(!value || typeof value!=='object'){
      // 형식이 어긋난 답은 같은 세션에서 한 번 바로잡게 합니다.
      reply=await sendTurn(session,'Your last answer was not a single JSON object matching the schema. Answer again with only that JSON object.');
      value=extractJson(reply);
    }
    if(!value || typeof value!=='object')throw Error('Gemini 구독 응답에서 JSON을 찾지 못했습니다: '+String(reply).slice(0,200));
    const out=JSON.stringify(value);
    session.sent=hashes;session.lastSent=hashes.at(-1)||'';session.lastReply=out;
    log('Gemini 세션 '+(continues?'이어서':'새로')+' · '+(Date.now()-started)+'ms · 보낸 글 '+text.length+'자');
    return out;
  }catch(error){
    session.close();if(current===session)current=null;
    throw error;
  }finally{
    clearBudget();
    if(!session.closed)session.release();
    clearInterval(tick);
  }
}
export function closeSession(){current?.close();current=null;}

// 보조 호출용 세션(작업 명세 만들기, 완료 검증, 요약 등): 호출마다 서로 무관한 요청이라 전체를 매번 보내되,
// CLI를 새로 띄우는 시간과 긴 지시문을 파일로 읽게 하는 느린 경로를 피합니다. 대화가 길어지지 않게 몇 번 쓰면 새로 엽니다.
let utility=null,utilityCalls=0;
process.on('exit',()=>closeAtExit(utility));
export async function utilityComplete(messages,format,{exe,model='',onProgress=()=>{},spawnProcess,log=()=>{},deadline,signal}={}){
  signal?.throwIfAborted();
  requireTextOnly(messages);
  if(!exe)throw Error('Gemini 구독 연결 도구(agy)를 찾지 못했습니다.');
  if(!utility || utility.closed || utility.model!==model || utilityCalls>=8){
    utility?.close();
    utility=startSession({exe,model,spawnProcess});utility.model=model;utilityCalls=0;
  }
  const session=utility;utilityCalls++;
  const clearBudget=bindBudget(session,{deadline,signal});
  const started=Date.now();
  const tick=setInterval(()=>onProgress('Gemini 구독 · 응답을 기다리는 중 ('+Math.round((Date.now()-started)/1000)+'초)'),5000);
  tick.unref?.();
  session.hold();
  try{
    await session.ready;
    const system=messages.filter(m=>m.role==='system').map(m=>m.content).join('\n\n');
    const convo=messages.filter(m=>m.role!=='system').map(m=>(m.role==='assistant'?'[ASSISTANT (earlier)]\n':'[USER / DATA]\n')+String(m.content??'')).join('\n\n');
    const text=['[INDEPENDENT REQUEST] This request stands alone. Ignore every earlier request and answer in this conversation.',
      '[HOW YOU ARE USED]\nYou are a decision model called by another program. Never use your own tools, never edit files or run commands, and do not explore the workspace. Work only from the text below.',
      system?'[SYSTEM INSTRUCTIONS]\n'+system:'','[CONVERSATION]\n'+convo,
      format?'[JSON SCHEMA]\n'+JSON.stringify(format)+'\n\n[YOUR TASK NOW]\nAnswer with exactly one JSON object matching the schema and nothing else.'
            :'[YOUR TASK NOW]\nWrite the assistant response as plain text only.'].filter(Boolean).join('\n\n');
    let reply=await askTurn(session,text);
    if(!format){
      if(!reply.trim())throw Error('Gemini 구독이 빈 답변을 보냈습니다.');
      log('Gemini 보조 호출 · '+(Date.now()-started)+'ms');
      return reply.trim();
    }
    let value=extractJson(reply);
    if(!value || typeof value!=='object'){
      reply=await sendTurn(session,'Your last answer was not a single JSON object matching the schema. Answer again with only that JSON object.');
      value=extractJson(reply);
    }
    if(!value || typeof value!=='object')throw Error('Gemini 구독 응답에서 JSON을 찾지 못했습니다: '+String(reply).slice(0,200));
    log('Gemini 보조 호출 · '+(Date.now()-started)+'ms');
    return JSON.stringify(value);
  }catch(error){
    session.close();if(utility===session)utility=null;
    throw error;
  }finally{
    clearBudget();
    if(!session.closed)session.release();
    clearInterval(tick);
  }
}
