// 모델 기억 한도(컨텍스트 창, num_ctx)를 요청마다 필요한 만큼 정합니다.
// - 보낼 글·이미지·도구 설명의 양을 어림하고, 답을 쓸 자리까지 더해 알맞은 크기를 고릅니다.
// - 이미 그 크기 이상으로 올라와 있으면 그대로 써서 모델을 다시 불러오지 않습니다(다시 불러오면 수 초~수십 초 걸림).
// - 그래도 한도에 걸려 답이 잘리면 한 단계 키워 한 번 더 받습니다.
// - 모델이 지원하는 최대 크기는 넘지 않습니다.

export const CONTEXT_STEPS=[8192,16384,32768,65536,131072];
export const STANDARD_CONTEXT=32768; // 앱 전체가 같은 크기를 쓰도록 맞춘 기본 기억 한도
const IMAGE_TOKENS=1100; // 화면 캡처 한 장이 차지하는 대략의 토큰 수

// 한국어는 1토큰이 대략 1.5~2글자, 영어·JSON은 3~4글자입니다. 모자라지 않게 2글자=1토큰으로 넉넉히 어림합니다.
export function estimateTokens(messages=[],tools=null){
  let chars=0,images=0;
  for(const m of messages){
    chars+=String(m?.content??'').length;
    if(Array.isArray(m?.tool_calls))chars+=JSON.stringify(m.tool_calls).length;
    if(Array.isArray(m?.images))images+=m.images.length;
  }
  if(tools)chars+=JSON.stringify(tools).length;
  return Math.ceil(chars/2)+images*IMAGE_TOKENS;
}

// floor: 지금 올라와 있는 크기(다시 불러오지 않으려고 이보다 줄이지 않음), max: 모델이 지원하는 최대 크기
export function chooseContext({estimate,predict=2048,floor=0,max=CONTEXT_STEPS.at(-1)}){
  const need=estimate+predict+1024;
  const step=CONTEXT_STEPS.find(size=>size>=need)||CONTEXT_STEPS.at(-1);
  const limit=Number.isFinite(max)&&max>0?max:CONTEXT_STEPS.at(-1);
  // 요청마다 크기가 달라지면(8K→16K→32K) Ollama가 그때마다 모델 전체(수~수십 GB)를 다시 불러옵니다.
  // 그래서 기본 크기(32K) 아래로는 고르지 않아 한 작업 안에서 크기가 바뀌지 않게 합니다.
  return Math.min(Math.max(step,floor||0,STANDARD_CONTEXT),limit);
}

export function nextContext(current,max){
  const next=CONTEXT_STEPS.find(size=>size>current);
  return next && (!max || next<=max)?next:null;
}

// 답이 "길이 한도"로 끝났고, 읽은 양+쓴 양이 기억 한도에 거의 닿았으면 기억 한도 때문에 잘린 것입니다.
// (답 길이 제한 num_predict에 걸린 경우와 구분합니다.)
export function cutByContext(data,numCtx){
  if(data?.done_reason!=='length')return false;
  const used=(data.prompt_eval_count||0)+(data.eval_count||0);
  return used>=numCtx*0.95;
}

// Ollama에서 모델의 최대 기억 한도와 지금 올라와 있는 크기를 읽습니다.
const maxCache=new Map();
export async function modelMaxContext(endpoint,model){
  if(maxCache.has(model))return maxCache.get(model);
  let max=null;
  try{
    const info=await fetch(endpoint+'/api/show',{method:'POST',body:JSON.stringify({name:model}),signal:AbortSignal.timeout(5000)}).then(r=>r.json());
    const key=Object.keys(info?.model_info||{}).find(k=>k.endsWith('.context_length'));
    if(key && Number.isFinite(info.model_info[key]))max=info.model_info[key];
  }catch{}
  maxCache.set(model,max);
  return max;
}
export async function loadedContext(endpoint,model,{signal}={}){
  try{
    const ps=await fetch(endpoint+'/api/ps',{signal:signal?AbortSignal.any([signal,AbortSignal.timeout(3000)]):AbortSignal.timeout(3000)}).then(r=>r.json());
    const hit=(ps?.models||[]).find(m=>(m.name||m.model)===model||(m.name||m.model)===model+':latest');
    return Number.isFinite(hit?.context_length)?hit.context_length:0;
  }catch{signal?.throwIfAborted();return 0;}
}

// 기억 한도 1토큰당 메모리(바이트)와, 한도와 상관없이 드는 고정 메모리를 모델 구조 정보로 계산합니다.
// - Gemma 4: 대부분 층은 최근 1,024토큰만 보는 층(고정 크기), 일부 층만 전체를 봅니다(토큰마다 늘어남).
// - Qwen 3.5: 4층마다 1층만 전체를 보고 나머지는 고정 크기 상태를 씁니다.
export function memoryProfile(info){
  const arch=info?.['general.architecture'];
  const get=key=>info?.[arch+'.'+key];
  const layers=Number(get('block_count'))||0;
  const kvHeads=get('attention.head_count_kv');
  const k=Number(get('attention.key_length'))||Number(get('attention.head_dim'))||128;
  const v=Number(get('attention.value_length'))||k;
  const window=Number(get('attention.sliding_window'))||0;
  const interval=Number(get('full_attention_interval'))||0;
  const bytes=2; // f16
  const heads=Array.isArray(kvHeads)?kvHeads.map(Number):Array.from({length:layers},()=>Number(kvHeads)||8);
  let perToken=0,fixed=0;
  if(window && Array.isArray(kvHeads)){
    // 헤드 수가 가장 흔한 층 = 최근 window 토큰만 보는 층, 나머지 = 전체를 보는 층
    const counts=new Map();for(const h of heads)counts.set(h,(counts.get(h)||0)+1);
    const local=[...counts.entries()].sort((a,b)=>b[1]-a[1])[0]?.[0];
    for(const h of heads){if(h===local)fixed+=h*(k+v)*bytes*window;else perToken+=h*(k+v)*bytes;}
  }else if(interval){
    perToken=Math.ceil(layers/interval)*heads[0]*(k+v)*bytes;
  }else{
    perToken=heads.reduce((sum,h)=>sum+h*(k+v)*bytes,0);
  }
  return {perToken,fixed};
}
const infoCache=new Map();
export async function modelProfile(endpoint,model,{signal}={}){
  signal?.throwIfAborted();
  if(infoCache.has(model))return infoCache.get(model);
  let profile={max:null,perToken:0,fixed:0};
  try{
    const info=(await fetch(endpoint+'/api/show',{method:'POST',body:JSON.stringify({name:model}),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(5000)]):AbortSignal.timeout(5000)}).then(r=>r.json()))?.model_info||{};
    const key=Object.keys(info).find(k=>k.endsWith('.context_length'));
    profile={max:key&&Number.isFinite(info[key])?info[key]:null,...memoryProfile(info)};
  }catch{signal?.throwIfAborted();}
  infoCache.set(model,profile);
  return profile;
}
const GiB=1024**3;
// 모델을 numCtx 기억 한도로 돌릴 때 필요한 메모리(GB): 모델 파일 + 대화 기억 공간
export const memoryNeedGB=(sizeGB,profile,numCtx)=>sizeGB+((profile?.fixed||0)+(profile?.perToken||0)*numCtx)/GiB;
// 남은 메모리(GB) 안에서 쓸 수 있는 최대 기억 한도(토큰). 알 수 없으면 null.
export function memoryContextCap({availableGB,sizeGB,profile,resident=false,margin=1.5}){
  if(!Number.isFinite(availableGB)||!profile?.perToken)return null;
  const free=availableGB-(resident?0:sizeGB)-margin-(profile.fixed||0)/GiB;
  return free>0?Math.floor(free*GiB/profile.perToken):0;
}
