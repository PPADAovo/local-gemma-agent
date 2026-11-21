// 자동 모델 선택: 가벼운 대화는 빠른 기본 모델로, 화면 조작·서비스 실행 같은 여러 단계 작업은
// 도구 사용을 더 잘 지키는 큰 모델로 처리합니다. 사용자가 모델을 직접 고른 경우에는 바꾸지 않습니다.

// 큰 작업용 후보 (둘 다 MoE라 크기에 비해 빠름). 앞에서부터 설치돼 있고 메모리에 들어가는 첫 모델을 씁니다.
export const AGENT_MODELS=['qwen3.5:35b','gemma4:26b'];

const HEAVY_TOOLS=new Set(['click','double_click','right_click','type','key','drag','scroll','focus','plugin_call','browser_click','browser_type','browser_key']);

// 요청 명세만 보고 큰 모델이 필요한 작업인지 판단합니다.
export function needsAgentModel(spec){
  if(!spec)return false;
  if(Array.isArray(spec.tools) && spec.tools.includes('plugin_call'))return true;
  if(spec.kind!=='action')return false;
  if(spec.desktop==='interact')return true;
  if(Array.isArray(spec.tools) && spec.tools.some(tool=>HEAVY_TOOLS.has(tool)))return true;
  return Array.isArray(spec.steps) && spec.steps.length>=4;
}

// fits(name): true(들어감) / false(안 들어감) / null(모름)
// AGENT_MODELS는 순위(앞이 더 좋음)입니다. 지금 모델보다 순위가 높은 후보만 고릅니다
// (예전에는 지금 모델이 목록에 있기만 하면 바꾸지 않아, 아래 순위의 모델에서 위 순위로 올라가지 못했습니다).
export function pickAgentModel({current,isInstalled,fits}){
  const rank=AGENT_MODELS.indexOf(current);
  const better=rank<0?AGENT_MODELS:AGENT_MODELS.slice(0,rank);
  return better.find(name=>isInstalled(name) && fits(name)!==false)||null;
}
