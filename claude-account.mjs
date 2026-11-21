// Claude 구독 연결: claude.ai 계정으로 로그인한 Claude Code CLI를 불러 씁니다(API 요금 없음, 구독 사용 한도 적용).
import {execModelProcess} from './model-process-lifecycle.mjs';
import path from 'node:path';
import os from 'node:os';
import {extractJson} from './cloud-brain.mjs';
const launcher=path.join(process.env.APPDATA||'','npm','node_modules','@anthropic-ai','claude-code','cli-wrapper.cjs');
function budget(options,max){options.signal?.throwIfAborted();const left=Math.min(max,Number.isFinite(options.deadline)?options.deadline-Date.now():max);if(left<=0)throw Object.assign(Error('작업 시간 제한에 도달했습니다.'),{code:'TASK_DEADLINE'});return {timeout:Math.ceil(left),...(options.signal?{signal:options.signal}:{})};}
export async function accountStatus(options={}){
  const env={...process.env};for(const k of ['ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN','ANTHROPIC_BASE_URL'])delete env[k];
  const {stdout}=await execModelProcess(process.execPath,[launcher,'auth','status','--json'],{env,windowsHide:true,...budget(options,20000),deadline:options.deadline}).catch(e=>{if(options.signal?.aborted)throw options.signal.reason;if(e.code==='TASK_DEADLINE')throw e;return {stdout:e.stdout||'{}'};});
  let info={};try{info=JSON.parse(stdout||'{}');}catch{}
  return info.loggedIn===true && info.authMethod==='claude.ai';
}
export async function status(options={}){
  if(await accountStatus(options))return {ok:true};
  return {ok:false,message:'Claude 구독 연결이 필요합니다. PowerShell에서 claude auth login --claudeai 를 실행하고 Claude 계정으로 승인하세요.'};
}
async function run(prompt,{onProgress=()=>{},...control}={}){
  const limits=budget(control,240000);
  const args=[launcher,'-p','--output-format','json','--tools','','--strict-mcp-config','--no-session-persistence'];
  // 구독 계정으로만 답하게 API 인증·주소 환경 변수는 빼고 실행합니다(있으면 API 요금으로 새어 나갈 수 있음).
  const env={...process.env,CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1'};
  for(const k of ['ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN','ANTHROPIC_BASE_URL'])delete env[k];
  const started=Date.now();
  onProgress('Claude 구독 · 응답을 기다리는 중 (0초)');
  const tick=setInterval(()=>onProgress('Claude 구독 · 응답을 기다리는 중 ('+Math.round((Date.now()-started)/1000)+'초)'),5000);
  try{
    const {stdout}=await execModelProcess(process.execPath,args,{env,cwd:os.tmpdir(),windowsHide:true,...limits,deadline:control.deadline,maxBuffer:8*1024*1024},prompt);
    const result=JSON.parse(stdout);
    if(result.is_error||!result.result?.trim())throw Error(String(result.result||'Claude Code 응답 실패').slice(0,350));
    return result.result.trim();
  }finally{clearInterval(tick);}
}
export async function reply(turns,input){
  const auth=await status();if(!auth.ok)throw Error(auth.message);
  const prompt=turns.length?'Previous conversation:\n'+JSON.stringify(turns.slice(-16).map(({role,content})=>({role,content})))+'\nCurrent user message:\n'+input:input;
  return run(prompt);
}
// 앱의 다른 두뇌와 같은 모양: complete(messages, format, {onProgress})
// 도구가 꺼진 상태라 화면 캡처 이미지는 보낼 수 없고 글만 보냅니다.
export async function complete(messages,format,options={}){
  budget(options,240000);
  if(messages.some(m=>Array.isArray(m.images)&&m.images.length))throw Object.assign(Error('현재 Claude 구독 연결은 화면 이미지를 전달하지 못합니다. 이미지 판단에는 로컬 시각 모델 또는 이미지 입력을 지원하는 연결을 선택하세요.'),{code:'VISION_UNSUPPORTED'});
  const auth=await status(options);if(!auth.ok)throw Error(auth.message);
  const system=messages.filter(m=>m.role==='system').map(m=>m.content).join('\n\n');
  const convo=messages.filter(m=>m.role!=='system').slice(-24).map(m=>({role:m.role==='assistant'?'assistant':'user',content:String(m.content??'').slice(-8000)}));
  const prompt=(system?'[SYSTEM INSTRUCTIONS]\n'+system+'\n\n':'')+'[CONVERSATION]\n'+JSON.stringify(convo)+'\n\nWrite the next assistant response. Do not use tools.'+(format?'\nReturn ONLY one JSON object (no code fence, no extra text) matching this JSON schema:\n'+JSON.stringify(format):'');
  const text=await run(prompt,options);
  if(!format)return text;
  const json=extractJson(text);
  if(!json)throw Error('Claude 응답에서 JSON을 찾지 못했습니다: '+text.slice(0,200));
  return JSON.stringify(json);
}
