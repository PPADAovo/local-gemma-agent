// 처음 켰을 때 채팅에서 하는 첫 설정 안내(/첫설정). 모델에게 맡기지 않고 정해진 순서로 진행합니다.
//  1. RAM과 그래픽카드 확인  2. 로컬 AI 실행기(Ollama) 확인  3. 모델 고르기(필요하면 승인 후 내려받기)
//  4. 앱·플러그인 연결 확인  5. 호칭과 권한 정하기  → 끝나면 setup-done.json 표시를 남깁니다.
import fs from 'node:fs/promises';
import path from 'node:path';

const gb=n=>Number.isFinite(n)?n.toFixed(n<10?1:0)+'GB':'알 수 없음';

// 그래픽카드(없으면 RAM) 크기로 새로 받을 모델을 고릅니다. 이미 설치된 것 중 맞는 게 있으면 그걸 씁니다.
export function recommendModel({vram,ram,installed=[],fitsGPU=()=>null,rank=[]}){
  const have=rank.find(name=>installed.includes(name) && fitsGPU(name)===true);
  if(have)return {name:have,installed:true,why:'그래픽카드에 통째로 들어가는 설치된 모델 중 가장 좋은 모델'};
  const memory=Number.isFinite(vram)&&vram>0?vram:null;
  const pick=memory>=10?{name:'gemma4:12b',size:7.5}:memory>=7?{name:'qwen3.5:9b',size:6.1}:memory>=4||ram>=16?{name:'gemma4:e4b',size:3.3}:{name:'gemma4:e2b',size:1.7};
  const already=installed.includes(pick.name);
  return {...pick,installed:already,why:memory?'그래픽카드 '+gb(memory)+'에 맞는 크기':'그래픽카드가 없어 RAM '+gb(ram)+'에서 돌릴 수 있는 크기'};
}

export async function runFirstSetup({progress=()=>{},ask,emit=()=>{},endpoint='http://127.0.0.1:11434',probe,listInstalled,fitsGPU,rank=[],checks={},saveNickname,dataDir,fetchImpl=fetch}){
  const lines=[];const step=(t)=>{progress(t);};
  // 1. RAM과 그래픽카드
  step('1/5 RAM과 그래픽카드를 확인합니다.');
  const cap=await probe().catch(()=>null);
  const ram=cap?.ramTotal,vram=cap?.vramTotal;
  lines.push('| RAM | '+gb(ram)+' |','| 그래픽카드 메모리 | '+(vram?gb(vram):'없음 (CPU로 실행)')+' |');
  // 2. Ollama
  step('2/5 로컬 AI 실행기(Ollama)를 확인합니다.');
  const ollamaUp=async()=>fetchImpl(endpoint+'/api/tags',{signal:AbortSignal.timeout(2500)}).then(r=>r.ok).catch(()=>false);
  if(!await ollamaUp()){
    const answer=await ask({kind:'question',title:'Ollama 설치가 필요해요',question:'이 앱은 이 PC 안에서 AI 모델을 돌리는 "Ollama"가 필요합니다.\n1. https://ollama.com/download 에서 Windows용을 내려받아 설치하세요.\n2. 설치가 끝나면 자동으로 알아채고 다음 단계로 넘어갑니다.',
      options:['설치했어요','나중에 할게요'],until:ollamaUp,untilAnswer:'설치했어요'});
    if(answer!=='설치했어요' || !await ollamaUp()){
      lines.push('| Ollama | ⬜ 설치 필요 — https://ollama.com/download |');
      return finish(lines,'Ollama가 없어 모델 설정은 건너뛰었습니다. 설치한 뒤 "/첫설정"을 다시 입력하면 이어서 진행합니다.',false);
    }
  }
  lines.push('| Ollama | ✅ 실행 중 |');
  // 3. 모델
  step('3/5 이 PC에 맞는 모델을 고릅니다.');
  let installed=await listInstalled().catch(()=>[]);
  const rec=recommendModel({vram,ram,installed,fitsGPU,rank});
  let modelLine;
  if(rec.installed)modelLine='✅ '+rec.name+' ('+rec.why+')';
  else{
    const answer=await ask({kind:'question',title:'모델 내려받기',question:'이 PC에는 '+rec.name+' 모델('+gb(rec.size)+')이 알맞습니다 — '+rec.why+'.\n내려받을까요? 인터넷으로 약 '+gb(rec.size)+'를 받으며, 몇 분 걸릴 수 있습니다.',options:['내려받기','나중에']});
    if(answer==='내려받기'){
      const ok=await pullModel(rec.name,{endpoint,progress,fetchImpl}).catch(e=>{progress('내려받기 실패: '+e.message);return false;});
      modelLine=ok?'✅ '+rec.name+' 내려받음':'⬜ '+rec.name+' 내려받기 실패 — 모델 메뉴에서 다시 받을 수 있어요';
    }else modelLine='⬜ '+rec.name+' 추천 (아직 안 받음 — 입력창 오른쪽 아래 모델 메뉴에서 받을 수 있어요)';
  }
  lines.push('| 모델 | '+modelLine+' |','| 모델 선택 | 자동 — 평소엔 빠른 모델, 어려운 작업에서 막히면 더 큰 모델로 바꿉니다 |');
  // 4. 연결
  step('4/5 앱과 플러그인 연결을 확인합니다.');
  for(const [label,check,how] of [
    ['Codex(ChatGPT) 계정',checks.codex,'설정 → 계정에서 로그인'],
    ['Gmail',checks.gmail,'설정 → 플러그인에서 Gmail 연결'],
    ['Notion',checks.notion,'설정 → 플러그인에서 Notion 연결'],
    ['GitHub',checks.github,'설정 → 플러그인에서 GitHub 연결'],
    ['Gemini(로컬이 막힐 때 도움)',checks.gemini,'앱 폴더의 "제미나이-연결.cmd" 실행'],
    ['Chrome 작업 탭 확장',checks.workTab,'설정 → 브라우저에서 확장 설치']]){
    if(!check)continue;
    step('연결 확인 · '+label);
    const ok=await Promise.race([check().catch(()=>false),new Promise(r=>setTimeout(()=>r(null),20000))]);
    lines.push('| '+label+' | '+(ok===true?'✅ 연결됨':ok===null?'⬜ 확인 시간 초과 — '+how:'⬜ 연결 안 됨 — '+how)+' |');
  }
  // 5. 호칭과 권한
  step('5/5 호칭과 권한을 정합니다.');
  const nick=String(await ask({kind:'question',title:'어떻게 불러 드릴까요?',question:'답변할 때 부를 호칭을 적어 주세요. (예: 길동님) 나중에 설정 → 개인 맞춤 설정에서 바꿀 수 있어요.',options:['건너뛰기']})||'').trim();
  if(nick && nick!=='건너뛰기' && nick.length<=20){await saveNickname?.(nick);emit('@prefs '+JSON.stringify({nickname:nick}));lines.push('| 호칭 | '+nick+' |');}
  const modes={'승인 요청 — 파일 변경·명령·앱 조작·인터넷 사용 시 항상 확인':'confirm','나 대신 승인 — 위험할 수 있는 작업만 확인 (추천)':'auto','전체 권한 — 승인 없이 실행, 되돌릴 수 없는 삭제만 확인':'full'};
  const picked=await ask({kind:'question',title:'작업 승인 방식',question:'에이전트가 컴퓨터에서 일할 때 언제 확인을 받을까요? 입력창 왼쪽 아래 버튼으로 언제든 바꿀 수 있어요.',options:Object.keys(modes),choicesOnly:true});
  const mode=modes[picked];
  if(mode){emit('@prefs '+JSON.stringify({approval:mode}));lines.push('| 승인 방식 | '+picked.split(' — ')[0]+' |');}
  if(dataDir){await fs.mkdir(dataDir,{recursive:true});await fs.writeFile(path.join(dataDir,'setup-done.json'),JSON.stringify({at:new Date().toISOString()}));}
  return finish(lines,'설정을 마쳤어요. 이제 "바탕화면 스크린샷 찍어줘", "메모장에 할 일 적어줘"처럼 편하게 요청해 보세요. "/첫설정"을 입력하면 언제든 다시 할 수 있어요.',true);
}

function finish(lines,tail,complete){
  return {answer:'## 첫 설정\n\n| 항목 | 결과 |\n|---|---|\n'+lines.join('\n')+'\n\n'+tail,complete};
}

// Ollama로 모델 내려받기(진행률 표시)
export async function pullModel(name,{endpoint,progress=()=>{},fetchImpl=fetch}){
  const r=await fetchImpl(endpoint+'/api/pull',{method:'POST',body:JSON.stringify({model:name,stream:true})});
  if(!r.ok)throw Error('Ollama 응답 '+r.status);
  let buf='',last=-1,ok=false;
  for await(const chunk of r.body){
    buf+=Buffer.from(chunk).toString('utf8');let i;
    while((i=buf.indexOf('\n'))>=0){
      const line=buf.slice(0,i);buf=buf.slice(i+1);
      let j;try{j=JSON.parse(line);}catch{continue;}
      if(j.error)throw Error(j.error);
      if(j.total&&j.completed){const pct=Math.floor(j.completed/j.total*100);if(pct!==last&&pct%5===0){last=pct;progress('모델 내려받는 중 · '+name+' '+pct+'%');}}
      if(j.status==='success')ok=true;
    }
  }
  return ok;
}
