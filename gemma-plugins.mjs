import fs from 'node:fs/promises';
import {validateArguments} from './service-agent-runtime.mjs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {skillOverrides,setSkillState} from './skill-availability.mjs';
import {classifySkill,RUNTIME_LABEL} from './skill-runtime.mjs';
import {localManager,localTools} from './local-service-plugins.mjs';
import {executable} from './codex-account.mjs';
import {gmailSuggestions} from './gmail-connector.mjs';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';

async function withServer(work){
  const child=spawn(await executable(),['app-server'],{windowsHide:true,stdio:['pipe','pipe','ignore']});
  const pending=new Map();
  let counter=0;
  const stop=error=>{for(const {reject} of pending.values())reject(error);pending.clear()};
  child.on('error',stop);
  child.on('exit',()=>stop(Error('플러그인 연결이 종료되었습니다.')));
  child.stdin.on('error',stop);
  const lines=createInterface({input:child.stdout});
  const send=value=>child.stdin.write(JSON.stringify(value)+'\n');
  lines.on('line',line=>{
    let message;try{message=JSON.parse(line)}catch{return}
    if(message.id==null)return;
    if(message.method){send({id:message.id,error:{code:-32601,message:'추가 인증 또는 대화형 승인이 필요합니다.'}});return}
    const waiter=pending.get(message.id);
    if(!waiter)return;
    pending.delete(message.id);
    if(message.error)waiter.reject(Error(message.error.message));else waiter.resolve(message.result);
  });
  const rpc=(method,params)=>new Promise((resolve,reject)=>{
    const id=++counter;pending.set(id,{resolve,reject});send({id,method,params});
  });
  const timer=setTimeout(()=>{stop(Error('플러그인 연결 시간 초과'));child.kill()},90000);
  try{
    await rpc('initialize',{clientInfo:{name:'gemma_local',version:'1.0'},capabilities:{experimentalApi:true}});
    return await work(rpc);
  }finally{clearTimeout(timer);lines.close();child.stdin.end();child.kill()}
}

const serviceOf=name=>name.split('::')[0].split('.')[0].toLowerCase();
const READ_FIRST=/(^|\.|_)(search|list|get|read|fetch|find|query)/i;
// annotations(읽기 전용 여부 등)는 항상 붙입니다. 빠지면 읽기만 하는 도구도 승인 카드를 띄우게 됩니다.
const brief=([name,spec],full)=>({name,description:(spec.description||'').slice(0,full?260:140),annotations:spec.annotations,...(full?{inputSchema:spec.inputSchema}:{})});
// 서비스 도구 검색. 검색어에 서비스 이름(google_calendar, gmail, calendar 등)이 들어 있으면 그 서비스의 도구를 "전부" 돌려줍니다
// (예전에는 8개로 잘려 search_events 같은 핵심 도구가 빠지고, 모델이 없는 이름(list_events)을 지어냈습니다).
// 입력 형식(inputSchema)은 검색어와 가장 맞는 도구, 그다음 조회형(search/list/get/read) 도구 순으로 앞쪽 10개에만 붙여 결과 길이를 줄입니다.
// 한국어 요청어를 서비스 이름으로 바꿉니다("일정" → calendar). 작은 모델은 서비스의 영어 이름을 모를 때가 많습니다.
const INTENT_WORDS=[[/일정|캘린더|달력|스케줄|약속|calendar/,'calendar'],[/메일|지메일|편지|gmail|email/,'gmail'],[/드라이브|구글\s*문서|스프레드시트|drive/,'drive'],[/연락처|contacts?/,'contacts'],[/노션|notion/,'notion'],[/깃허브|github/,'github']];
export function searchTools(tools,query){
  const raw=String(query||'').toLowerCase().trim();
  const words=[...raw.split(/[\s.]+/).filter(Boolean),...INTENT_WORDS.filter(([pattern])=>pattern.test(raw)).map(([,service])=>service)];
  const entries=Object.entries(tools);
  if(!words.length)return [...new Set(entries.map(([name])=>serviceOf(name)))].sort();
  const services=new Set(entries.map(([name])=>serviceOf(name)));
  const service=[...services].find(s=>words.includes(s)) || [...services].find(s=>words.some(w=>w.length>=4 && s.split('_').includes(w)));
  if(service){
    const rest=words.filter(w=>w!==service && !service.split('_').includes(w));
    const score=([name,spec])=>rest.filter(w=>(name+' '+(spec.description||'')).toLowerCase().includes(w)).length*10+(READ_FIRST.test(name.split('.').pop())?1:0);
    const own=entries.filter(([name])=>serviceOf(name)===service).sort((a,b)=>score(b)-score(a)||a[0].localeCompare(b[0]));
    return own.map((entry,i)=>brief(entry,i<10));
  }
  return entries.filter(([name,spec])=>words.every(word=>(name+' '+(spec.description||'')).toLowerCase().includes(word))).slice(0,12).map(entry=>brief(entry,true));
}
// 없는 도구 이름을 부르면 같은 서비스의 실제 도구 이름과, 이름이 가장 비슷한 도구의 입력 형식을 알려 줍니다.
export function unknownToolMessage(tools,wanted){
  const service=serviceOf(String(wanted||''));
  const own=Object.entries(tools).filter(([name])=>serviceOf(name)===service);
  if(!own.length)return '연결 목록에 없는 플러그인 도구입니다: '+wanted+'. plugin_search로 서비스 이름을 검색해 실제 도구 이름을 확인하세요.';
  const parts=s=>String(s).split('.').pop().toLowerCase().split('_');
  const want=parts(wanted);
  const closest=own.map(entry=>[entry,parts(entry[0]).filter(p=>want.includes(p)).length+(READ_FIRST.test(entry[0].split('.').pop())&&READ_FIRST.test(want[0])?0.5:0)])
    .sort((a,b)=>b[1]-a[1])[0];
  const hint=closest&&closest[1]>0?' 가장 비슷한 도구는 '+closest[0][0]+'이고 입력 형식은 '+JSON.stringify(closest[0][1].inputSchema?.properties?Object.keys(closest[0][1].inputSchema.properties):{})+'입니다.':'';
  return wanted+'라는 도구는 없습니다. '+service+'에서 쓸 수 있는 도구: '+own.map(([name])=>name).join(', ')+'.'+hint+' 이 목록에 있는 정확한 이름으로 다시 plugin_call 하세요.';
}

// 작은 모델이 자주 내는 형식 실수를 보내기 전에 바로잡습니다(로그: "a,b" 문자열, {"ids":[…]} 같은 줄인 이름).
// 바로잡을 수 있는 것을 오류로 돌려보내면 모델이 같은 호출을 여러 번 고치며 그때마다 승인 카드가 다시 떴습니다.
const wantsArray=s=>s&&(s.type==='array'||(Array.isArray(s.type)&&s.type.includes('array'))||(s.anyOf||s.oneOf||[]).some(x=>x?.type==='array'));
const wantsString=s=>s&&(s.type==='string'||(s.anyOf||s.oneOf||[]).some(x=>x?.type==='string'));
export function coerceArguments(schema,args){
  const props=schema?.properties;
  if(!props||!args||typeof args!=='object'||Array.isArray(args))return args;
  const out={...args};
  // 필수 입력이 빠졌고, 이름이 그 끝부분과 같은 입력 하나가 있으면 옮깁니다(ids → message_ids, id → message_id).
  for(const key of schema.required||[]){
    if(Object.hasOwn(out,key))continue;
    const stem=k=>k.replace(/s$/,'');
    const alias=Object.keys(out).filter(k=>!Object.hasOwn(props,k)&&stem(key).endsWith('_'+stem(k)));
    if(alias.length===1){out[key]=out[alias[0]];delete out[alias[0]];}
  }
  for(const [key,spec] of Object.entries(props)){
    const value=out[key];
    if(value===undefined||value===null)continue;
    if(wantsArray(spec)&&typeof value==='string')out[key]=value.split(/[\s,]+/).filter(Boolean);
    else if(wantsArray(spec)&&!Array.isArray(value)&&typeof value!=='object')out[key]=[value];
    else if(wantsString(spec)&&!wantsArray(spec)&&Array.isArray(value)&&value.length===1&&typeof value[0]==='string')out[key]=value[0];
  }
  return out;
}

// 보내기 전에 입력값을 도구의 입력 형식과 대조합니다. 틀린 이름(calendar_ids ↔ calendar_id)이나 빠진 필수 값은
// 서비스까지 보내지 않고, 고칠 방법(허용되는 이름·필수 값·예시)을 바로 알려 줍니다.
export function argumentProblem(name,schema,args){
  if(!args||typeof args!=='object'||Array.isArray(args))return name+' 입력은 JSON 객체여야 합니다.';
  // 맨 위에 properties가 없는 형식(allOf·anyOf로 조합한 형식, false)도 validateArguments로 검사합니다.
  // (예전에는 properties가 없으면 검사 없이 통과시켜, 필수 입력이 빠진 호출이 서비스까지 갔습니다.)
  if(schema===undefined||schema===null)return '';
  const props=schema?.properties&&typeof schema.properties==='object'?schema.properties:{};
  const allowed=Object.keys(props);
  const near=key=>allowed.find(a=>a===key.replace(/s$/,'')||a+'s'===key||a.replace(/_str$/,'')===key.replace(/^response_|_str$/g,''));
  // 모르는 입력 이름: "추가 입력 금지"가 명시됐으면 전부, 아니어도 진짜 이름과 거의 같은 오타(calendar_ids → calendar_id)는 잡습니다.
  // 실제 서비스 스키마는 금지를 명시하지 않는 경우가 많아, 오타가 그대로 서비스까지 가서 실패하곤 했습니다.
  const unknown=allowed.length?Object.keys(args).filter(key=>!allowed.includes(key)&&(schema.additionalProperties===false||near(key))):[];
  const missing=(schema?.required||[]).filter(key=>!Object.hasOwn(args,key));
  const errors=validateArguments(args,schema);
  if(!unknown.length&&!missing.length&&!errors.length)return '';
  const lines=[name+' 입력이 형식과 맞지 않아 보내지 않았습니다.'];
  if(unknown.length)lines.push('없는 입력 이름: '+unknown.map(k=>near(k)?k+'(→ '+near(k)+')':k).join(', '));
  if(missing.length)lines.push('빠진 필수 입력: '+missing.join(', '));
  if(errors.length)lines.push(errors.join('; '));
  lines.push('쓸 수 있는 입력: '+allowed.map(k=>k+((schema.required||[]).includes(k)?'(필수)':'')).join(', '));
  const example=Object.fromEntries(allowed.filter(k=>(schema.required||[]).includes(k)||args[k]!==undefined||near(Object.keys(args).find(u=>near(u)===k)||'')).map(k=>[k,args[k]??args[Object.keys(args).find(u=>near(u)===k)]??'…']));
  if(Object.keys(example).length)lines.push('예: '+JSON.stringify(example));
  return lines.join('\n');
}

export async function pluginTools(query='',call=null){
  if(call?.name?.startsWith('local.'))return localTools('',call);
  if(!call && query.trim().startsWith('local.'))return localTools(query,null);
  if(!call){
    const local=await localTools(query,null);
    // Local shortcuts (e.g. local.github.open) must not hide the connected service's real tools.
    if(query.trim()){try{return [...local,...await remoteTools(query,null)];}catch(error){if(local.length)return local;throw error;}}
    try{return [...local.map(x=>x.name),...await remoteTools(query,null)];}catch{return local.map(x=>x.name);}
  }
  return remoteTools(query,call);
}
async function remoteTools(query,call){
  return withServer(async rpc=>{
    const thread=call?(await rpc('thread/start',{cwd:process.cwd(),ephemeral:true,sandbox:'read-only',approvalPolicy:'on-request'})).thread.id:null;
    const tools=Object.create(null);
    const routes=new Map();
    let cursor=null;
    do{
      const result=await rpc('mcpServerStatus/list',{detail:'toolsAndAuthOnly',threadId:thread,cursor});
      for(const server of result.data){
        for(const [tool,spec] of Object.entries(server.tools||{})){
          const key=server.name==='codex_apps'?tool:server.name+'::'+tool;
          tools[key]=spec;routes.set(key,{server:server.name,tool});
        }
      }
      cursor=result.nextCursor;
    }while(cursor);
    if(!call)return searchTools(tools,query);
    if(!Object.hasOwn(tools,call.name))throw Error(unknownToolMessage(tools,call.name));
    const args=coerceArguments(tools[call.name].inputSchema,call.args||{});
    const invalid=argumentProblem(call.name,tools[call.name].inputSchema,args);
    if(invalid)throw Error(invalid);
    const result=await rpc('mcpServer/tool/call',{threadId:thread,...routes.get(call.name),arguments:args});
    return serializeToolResult(result);
  });
}
export function serializeToolResult(result){
  const message=(result.content||[]).filter(item=>item.type==='text').map(item=>item.text).join('\n');
  if(result.isError)throw Error(message.slice(0,1500)||'플러그인 실행 실패');
  if(result.structuredContent!=null)return JSON.stringify(result.structuredContent);
  return message||'텍스트 결과가 없는 도구입니다.';
}
const koreanSkills = {
  "automate": [
    "자동화 만들기",
    "반복 작업을 예약합니다",
    "실행할 작업과 주기를 정해 Codex 자동화를 등록합니다."
  ],
  "autopilot": [
    "PR 병합 준비",
    "리뷰와 CI 실패를 처리합니다",
    "리뷰 의견과 충돌을 확인하고 코드를 수정한 뒤 병합 가능한지 다시 검사합니다."
  ],
  "canvas": [
    "캔버스",
    "대화형 작업 화면을 만듭니다",
    "채팅 옆에 표와 차트, 입력 도구를 배치해 데이터를 탐색합니다."
  ],
  "computer-use:computer-use": [
    "컴퓨터 조작",
    "Windows 앱을 조작합니다",
    "화면의 창과 컨트롤을 찾아 클릭, 입력, 메뉴 선택을 수행합니다."
  ],
  "create-hook": [
    "이벤트 훅 만들기",
    "이벤트에 동작을 연결합니다",
    "특정 에이전트 이벤트에 실행할 스크립트와 훅 설정을 작성합니다."
  ],
  "create-rule": [
    "작업 규칙 만들기",
    "지속적으로 적용할 지침을 작성합니다",
    "프로젝트 전체 또는 특정 파일에 적용할 개발 규칙을 설정합니다."
  ],
  "create-skill": [
    "작업 스킬 만들기",
    "반복 작업을 스킬로 묶습니다",
    "스킬의 사용 조건과 작업 절차를 SKILL.md에 작성합니다."
  ],
  "create-subagent": [
    "하위 에이전트 만들기",
    "전문 역할을 담당할 에이전트를 구성합니다",
    "리뷰나 디버깅처럼 분리할 업무와 에이전트 지침을 정의합니다."
  ],
  "documents:documents": [
    "문서 작성·편집",
    "Word 문서를 만들고 편집합니다",
    "표와 문단, 주석과 변경 내용을 편집한 뒤 페이지 배치를 확인합니다."
  ],
  "goal": [
    "목표 설정",
    "작업의 완료 조건을 정합니다",
    "달성할 결과를 명시하고 진행 상황을 추적합니다."
  ],
  "hatch-pet": [
    "움직이는 펫 만들기",
    "Codex 캐릭터를 제작합니다",
    "동작 이미지를 생성하고 애니메이션을 검토해 펫 패키지로 묶습니다."
  ],
  "loop": [
    "반복 실행",
    "현재 채팅에서 작업을 반복합니다",
    "프롬프트나 스킬을 일정한 간격 또는 상황에 맞춘 간격으로 실행합니다."
  ],
  "migrate-to-skills": [
    "기존 규칙을 스킬로 변환",
    "규칙과 명령을 스킬로 옮깁니다",
    "기존 규칙과 슬래시 명령의 사용 조건을 보존해 스킬 디렉터리로 재구성합니다."
  ],
  "new-repo": [
    "저장소 만들기",
    "프로젝트에 원격 저장소를 연결합니다",
    "Codex에서 호스팅하는 저장소를 만들고 현재 프로젝트를 푸시합니다."
  ],
  "onboard": [
    "시작 안내",
    "작업 방식과 첫 목표를 설정합니다",
    "선호하는 환경을 확인하고 첫 목표에 맞는 작업으로 안내합니다."
  ],
  "origin": [
    "저장소 연결 도구 설정",
    "origin CLI를 설치하고 연결합니다",
    "저장소 복제와 푸시에 필요한 로그인, 업데이트와 연결 문제를 처리합니다."
  ],
  "pdf:pdf": [
    "PDF 작업",
    "PDF를 읽고 만들고 편집합니다",
    "텍스트를 추출하거나 양식을 작성하고 페이지를 렌더링해 배치를 확인합니다."
  ],
  "presentations:presentations": [
    "발표 자료",
    "슬라이드를 만들고 편집합니다",
    "기존 발표 자료나 템플릿을 읽고 요청한 형식에 맞춰 내용과 구성을 수정합니다."
  ],
  "rename-chat": [
    "채팅 이름 바꾸기",
    "현재 채팅의 제목을 변경합니다",
    "/rename-chat 명령으로 대화 내용이나 지정한 주제에 맞는 제목을 정합니다."
  ],
  "review": [
    "코드 검토",
    "코드 변경의 문제를 검토합니다",
    "변경 내용에 맞는 검토 에이전트로 오류와 보안 문제를 확인합니다."
  ],
  "review-bugbot": [
    "버그 검토",
    "변경으로 생긴 오류를 찾습니다",
    "Bugbot이 변경된 코드를 읽고 잘못된 동작과 회귀 가능성을 보고합니다."
  ],
  "review-security": [
    "보안 검토",
    "코드의 보안 문제를 점검합니다",
    "보안 검토 에이전트가 변경 내용을 읽고 발견한 문제와 영향을 정리합니다."
  ],
  "sdk": [
    "Codex SDK 개발",
    "프로그램에서 에이전트를 실행합니다",
    "TypeScript나 Python에서 에이전트 실행, 이벤트 처리와 세션 재개를 연결합니다."
  ],
  "share": [
    "프로젝트 저장·공유",
    "프로젝트를 원격에 보관합니다",
    "버전을 기록할 저장소를 구성하고 프로젝트 변경 내용을 업로드합니다."
  ],
  "shell": [
    "셸 명령 실행",
    "입력한 명령을 터미널에서 실행합니다",
    "/shell 뒤에 작성한 명령을 그대로 전달해 실행 결과를 확인합니다."
  ],
  "split-to-prs": [
    "PR 나누기",
    "변경 사항을 작은 PR로 나눕니다",
    "함께 검토할 변경을 묶고 의존 관계에 맞춰 여러 PR로 정리합니다."
  ],
  "spreadsheets:spreadsheets": [
    "스프레드시트 작업",
    "표와 수식, 차트를 편집합니다",
    "Excel 파일이나 시트의 데이터를 분석하고 계산식과 서식을 적용합니다."
  ],
  "spreadsheets:excel-live-control": [
    "열린 Excel 조작",
    "연결된 통합 문서를 편집합니다",
    "현재 열려 있는 Excel 세션에서 시트와 셀 범위를 선택해 변경합니다."
  ],
  "statusline": [
    "상태 표시줄 설정",
    "CLI 아래에 표시할 정보를 고릅니다",
    "터미널 상태 표시줄에 세션 정보와 작업 상태를 배치합니다."
  ],
  "systematic-debugging": [
    "오류 원인 분석",
    "오류를 재현하고 원인을 찾습니다",
    "실행 결과로 가설을 검증한 뒤 원인을 수정하고 같은 조건에서 다시 확인합니다."
  ],
  "template-creator:template-creator": [
    "템플릿 만들기",
    "참고 자료를 템플릿으로 만듭니다",
    "문서와 슬라이드 등의 구조와 스타일을 재사용할 수 있는 스킬로 저장합니다."
  ],
  "test-driven-development": [
    "테스트 주도 개발",
    "기대 동작을 테스트로 먼저 정의합니다",
    "실패하는 테스트를 확인하고 통과에 필요한 코드를 구현한 뒤 구조를 정리합니다."
  ],
  "update-cli-config": [
    "CLI 환경 설정",
    "명령줄 도구의 설정을 변경합니다",
    "권한, 승인 방식, 편집 모드와 표시 옵션을 설정 파일에서 조정합니다."
  ],
  "update-cursor-settings": [
    "편집기 설정",
    "Cursor와 VS Code 환경을 조정합니다",
    "글꼴, 테마, 들여쓰기와 저장 시 서식 지정 등을 변경합니다."
  ],
  "verification-before-completion": [
    "완료 전 검증",
    "수정 결과를 실제 검사로 확인합니다",
    "완료를 보고하기 전에 관련 빌드나 테스트를 실행하고 출력을 확인합니다."
  ],
  "visualize:visualize": [
    "대화형 시각화",
    "개념과 데이터를 그림으로 탐색합니다",
    "차트, 지도, 시뮬레이션으로 조건에 따라 결과가 어떻게 달라지는지 보여줍니다."
  ],
  "writing-plans": [
    "구현 계획 작성",
    "요구 사항을 실행 단계로 나눕니다",
    "여러 단계가 필요한 작업에서 수정 범위와 검증 방법을 미리 정리합니다."
  ],
  "imagegen": [
    "이미지 생성·편집",
    "설명이나 참고 이미지로 그림을 만듭니다",
    "새 이미지를 생성하거나 기존 이미지의 배경, 색상, 구성과 스타일을 수정합니다."
  ],
  "openai-docs": [
    "OpenAI 문서 안내",
    "제품과 API의 공식 사용법을 찾습니다",
    "모델 선택, SDK 연동과 Codex 설정에 필요한 공식 문서를 확인합니다."
  ],
  "review-agent": [
    "리뷰 에이전트",
    "코드 검토를 수행합니다",
    "변경 내용을 읽고 수정이 필요한 위치와 판단 근거를 정리합니다."
  ],
  "skill-creator": [
    "스킬 설계·개선",
    "새 스킬을 설계하고 기존 스킬을 개선합니다",
    "사용 조건과 지침을 정리하고 필요한 스크립트와 참고 자료를 함께 구성합니다."
  ],
  "skill-installer": [
    "스킬 설치",
    "목록이나 저장소에서 스킬을 설치합니다",
    "설치 가능한 스킬을 확인하고 선택한 항목을 로컬 스킬 폴더에 추가합니다."
  ]
};
// 서비스 하나의 실제 연결 상태: 카탈로그에 있는지, 설치·켜짐 여부, 연결된 도구 수, 공급자 HTTPS 연결 주소.
export async function serviceStatus(slug,serverRunner=withServer){
  return serverRunner(async rpc=>{
    const catalog=await rpc('plugin/list',{});
    let found=null;
    for(const market of catalog.marketplaces){
      const plugin=market.plugins.find(x=>x.name===slug);
      if(plugin){found={market,plugin};break;}
    }
    if(!found)return null;
    const {market,plugin}=found;
    const where=market.path?{marketplacePath:market.path}:{remoteMarketplaceName:market.name};
    const read=await rpc('plugin/read',{pluginName:plugin.name,...where});
    const status=await rpc('mcpServerStatus/list',{serverName:'codex_apps',detail:'toolsAndAuthOnly'});
    const prefix=plugin.name.replaceAll('-','_')+'.';
    const tools=status.data.flatMap(server=>Object.keys(server.tools||{})).filter(name=>name.startsWith(prefix));
    const url=(read.plugin.apps||[]).map(app=>app.installUrl).find(value=>{
      if(typeof value!=='string')return false;
      try{const parsed=new URL(value);return parsed.protocol==='https:'&&!!parsed.hostname;}catch{return false;}
    })||null;
    return {id:plugin.id,slug:plugin.name,name:plugin.interface?.displayName||plugin.name,
      installed:!!plugin.installed,enabled:!!plugin.enabled,connected:!!plugin.enabled&&tools.length>0,url};
  });
}
// 여러 서비스의 실제 연결 상태를 한 번에 확인합니다(켜져 있고 실제 도구가 있는 것만 connected).
// 플러그인 화면이 '웹사이트 바로가기'를 계정 연결처럼 보이게 하던 문제(2026-11-20)를 고치는 데 씁니다.
export async function connectedServices(slugs,serverRunner=withServer){
  return serverRunner(async rpc=>{
    const catalog=await rpc('plugin/list',{});
    const status=await rpc('mcpServerStatus/list',{serverName:'codex_apps',detail:'toolsAndAuthOnly'});
    const tools=status.data.flatMap(server=>Object.keys(server.tools||{}));
    const result={};
    for(const slug of slugs){
      const plugin=catalog.marketplaces.flatMap(market=>market.plugins).find(x=>x.name===slug);
      const prefix=slug.replaceAll('-','_')+'.';
      result[slug]=Boolean(plugin?.enabled&&tools.some(name=>name.startsWith(prefix)));
    }
    return result;
  });
}
// 사용자가 카드에서 [켜기]를 누른 서비스만 켭니다. 설치되지 않은 서비스는 설치 후 켭니다.
export async function enableService(slug,serverRunner=withServer){
  return serverRunner(async rpc=>{
    const catalog=await rpc('plugin/list',{});
    for(const market of catalog.marketplaces){
      const plugin=market.plugins.find(x=>x.name===slug);
      if(!plugin)continue;
      const where=market.path?{marketplacePath:market.path}:{remoteMarketplaceName:market.name};
      if(!plugin.installed)await rpc('plugin/install',{pluginName:plugin.name,...where});
      await rpc('config/value/write',{keyPath:'plugins.'+JSON.stringify(plugin.id)+'.enabled',value:true,mergeStrategy:'upsert'});
      return {ok:true};
    }
    throw Error('플러그인 목록에서 '+slug+'을(를) 찾지 못했습니다.');
  });
}
export async function managePlugins(request,serverRunner=withServer){
  if(request.tab==='스킬' && request.id && request.source!=='codex')return setSkillState(request.id,request.state);
  if(request.source!=='codex' && (['홈','플러그인','디렉터리'].includes(request.tab)||request.id))return localManager(request);
  return serverRunner(async rpc=>{
    const {tab,id,enable}=request;
    if(request.action==='details' && request.slug==='gmail'){
      const catalog=await rpc('plugin/list',{});
      let found=null;
      for(const market of catalog.marketplaces){
        const plugin=market.plugins.find(x=>x.name==='gmail');
        if(plugin){found={market,plugin};break;}
      }
      if(!found)throw Error('Codex 플러그인 목록에서 Gmail을 찾지 못했습니다.');
      const {market,plugin}=found;
      const read=await rpc('plugin/read',{pluginName:plugin.name,...(market.path?{marketplacePath:market.path}:{remoteMarketplaceName:market.name})});
      const status=await rpc('mcpServerStatus/list',{serverName:'codex_apps',detail:'toolsAndAuthOnly'});
      const prefix=plugin.name.replaceAll('-','_')+'.';
      const tools=status.data.flatMap(server=>Object.entries(server.tools||{}))
        .filter(([name])=>name.startsWith(prefix))
        .map(([name,spec])=>({name,description:spec.description||'',inputSchema:spec.inputSchema}));
      const installUrl=(read.plugin.apps||[]).map(app=>app.installUrl).find(value=>{
        if(typeof value!=='string')return false;
        try{const parsed=new URL(value);return parsed.protocol==='https:'&&!!parsed.hostname;}catch{return false;}
      })||null;
      const metadata=plugin.interface||{};
      return {
        id:plugin.id,slug:plugin.name,name:metadata.displayName||plugin.name,
        description:metadata.longDescription||metadata.shortDescription||'',
        installed:!!plugin.installed,enabled:!!plugin.enabled,connected:tools.length>0,
        available:!!plugin.enabled&&tools.length>0,url:installUrl,tools,suggestions:gmailSuggestions
      };
    }
    if(tab==='앱'||tab==='MCP'){
      const rows=[];let cursor=null;
      do{
        const method=tab==='앱'?'app/list':'mcpServerStatus/list';
        const result=await rpc(method,{cursor,limit:100,...(tab==='MCP'?{detail:'toolsAndAuthOnly'}:{})});
        for(const x of result.data){
          if(tab==='앱' && !x.isAccessible)continue;
          rows.push({name:x.name,description:tab==='앱'?x.description:Object.keys(x.tools||{}).length+'개 도구',detail:tab==='앱'?(x.isEnabled?'사용 가능':'사용 꺼짐'):Object.keys(x.tools||{}).join(', ')});
        }
        cursor=result.nextCursor;
      }while(cursor);
      if(tab==='앱'){
        const catalog=await rpc('plugin/list',{});
        let gmail=null;
        for(const market of catalog.marketplaces){
          const plugin=market.plugins.find(x=>x.name==='gmail');
          if(plugin){gmail=plugin;break;}
        }
        if(gmail){
          const row=rows.find(x=>String(x.name).toLowerCase()==='gmail');
          if(row){
            Object.assign(row,{id:gmail.id,slug:gmail.name,installed:!!gmail.installed,enabled:!!gmail.enabled,connected:true});
          }else{
            rows.push({
              id:gmail.id,slug:gmail.name,name:gmail.interface?.displayName||'Gmail',
              description:gmail.interface?.shortDescription||'',
              detail:gmail.enabled?'사용 가능':'사용 꺼짐',
              installed:!!gmail.installed,enabled:!!gmail.enabled,connected:false
            });
          }
        }
      }
      return {rows};
    }
    if(tab==='스킬'){
      const [r,states]=await Promise.all([rpc('skills/list',{cwds:[process.cwd()]}),skillOverrides()]);
      const rows=r.data.flatMap(x=>x.skills).map(x=>{
        const [displayName,description,details]=koreanSkills[x.name.toLowerCase()] ?? [x.name,x.description,x.description];
        const kind=classifySkill(x);
        return {name:x.name,displayName,description:RUNTIME_LABEL[kind.runtime]+' · '+description,details:details+'\n\n['+RUNTIME_LABEL[kind.runtime]+'] '+kind.reason,detail:x.path,runtime:kind.runtime,state:states.get(x.name)||'enabled'};
      });
      const root=fileURLToPath(new URL('./스킬/',import.meta.url));
      for(const entry of await fs.readdir(root,{withFileTypes:true})){
        if(!entry.isDirectory() || !entry.name.startsWith('custom-'))continue;
        const detail=path.join(root,entry.name,'SKILL.md');
        const guide=await fs.readFile(detail,'utf8').catch(()=> '');
        const name=/^name: (.+)$/m.exec(guide)?.[1]?.trim();
        if(!name || rows.some(row=>row.name===name))continue;
        const description=/^description: (.+)$/m.exec(guide)?.[1]?.trim() || '';
        const kind=classifySkill({name});
        rows.push({name,displayName:name,description:RUNTIME_LABEL[kind.runtime]+' · '+description,details:description+'\n\n['+RUNTIME_LABEL[kind.runtime]+'] '+kind.reason,detail,runtime:kind.runtime,state:states.get(name)||'enabled'});
      }
      return request.withSidebar?{rows,installedPlugins:(await localManager({tab:'플러그인'})).rows}:{rows};
    }
    const catalog=await rpc('plugin/list',{});
    const rows=[];
    for(const market of catalog.marketplaces)for(const p of market.plugins){
      if(id===p.id){
        if(request.action==='connection'){
          const result=await rpc('plugin/read',{pluginName:p.name,...(market.path?{marketplacePath:market.path}:{remoteMarketplaceName:market.name})});
          const apps=result.plugin.apps||[];
          const status=await rpc('mcpServerStatus/list',{serverName:'codex_apps',detail:'toolsAndAuthOnly'});
          const names=status.data.flatMap(server=>Object.keys(server.tools||{}));
          const prefix=p.name.replaceAll('-','_')+'.';
          return {available:p.enabled&&names.some(tool=>tool.startsWith(prefix)),enabled:p.enabled,url:apps.find(a=>a.installUrl)?.installUrl||'https://chatgpt.com/#settings/Connectors'};
        }
        if(request.action==='install'){
          await rpc('plugin/install',{pluginName:p.name,...(market.path?{marketplacePath:market.path}:{remoteMarketplaceName:market.name})});
        }else if(request.action==='toggle' && p.installed && typeof enable==='boolean'){
          await rpc('config/value/write',{keyPath:'plugins.'+JSON.stringify(p.id)+'.enabled',value:enable,mergeStrategy:'upsert'});
        }else throw Error('지원하지 않는 플러그인 작업입니다.');
        return {ok:true};
      }
      const popular=['gmail','google-drive','google-calendar','github','slack','outlook-email','icloud-mail','icloud-calendar','elevenlabs','tripsy','sonos','hevy','dropbox','hubspot'].includes(p.name);
      if(id || (tab==='홈'?(!popular&&!p.installed):(tab==='디렉터리'?p.installed:!p.installed)))continue;
      const ui=p.interface||{};
      rows.push({id:p.id,slug:p.name,installed:p.installed,name:ui.displayName||p.name,description:ui.shortDescription||'',detail:tab==='디렉터리'?'':(ui.longDescription||ui.shortDescription||p.name),enabled:p.enabled});
    }
    if(id)throw Error('목록에서 플러그인을 찾지 못했습니다.');
    return {rows};
  });
}
