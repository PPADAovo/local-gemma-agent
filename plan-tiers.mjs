// 구독 등급 확인: 로그인한 계정 정보에서 Gemini·ChatGPT·Claude 요금제 등급을 읽어 모델 메뉴에 보여 줍니다.
// - Claude: Claude Code의 `auth status --json` → subscriptionType (pro, max …)
// - ChatGPT: Codex 로그인 파일(~/.codex/auth.json)의 id_token 안 chatgpt_plan_type (plus, pro, prolite …)
//   토큰 값 자체는 읽기만 하고 출력·저장하지 않습니다. 등급 글자만 꺼냅니다.
// - Gemini: `agy models` 목록에 붙은 Google One 등급 표시(…-g1-pro → AI Pro, …-g1-ultra → AI Ultra)
// 결과는 %LOCALAPPDATA%\LocalGemmaDesktop\plans.json 에 저장하고, 앱 메뉴가 이 파일을 읽습니다.
import {appDataDir} from './app-data.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';

const run=promisify(execFile);
const pretty=(map,value)=>{const v=String(value||'').toLowerCase().trim();if(!v)return null;return map[v]||v.replace(/(^|[_\s-])(\w)/g,(_,a,b)=>(a?' ':'')+b.toUpperCase());};

export async function claudeTier(){
  const launcher=path.join(process.env.APPDATA||'','npm','node_modules','@anthropic-ai','claude-code','cli-wrapper.cjs');
  const env={...process.env};for(const k of ['ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN','ANTHROPIC_BASE_URL'])delete env[k];
  try{
    const {stdout}=await run(process.execPath,[launcher,'auth','status','--json'],{env,windowsHide:true,timeout:20000});
    const info=JSON.parse(stdout);
    if(info.loggedIn!==true||info.authMethod!=='claude.ai')return null;
    return pretty({free:'Free',pro:'Pro',max:'Max',team:'Team',enterprise:'Enterprise'},info.subscriptionType||info.planTier);
  }catch{return null;}
}
export async function chatgptTier(){
  try{
    const auth=JSON.parse(await fs.readFile(path.join(os.homedir(),'.codex','auth.json'),'utf8'));
    const token=auth?.tokens?.id_token;if(typeof token!=='string')return null;
    const claim=JSON.parse(Buffer.from(token.split('.')[1]||'','base64url').toString('utf8'))['https://api.openai.com/auth']||{};
    return pretty({free:'Free',go:'Go',plus:'Plus',pro:'Pro',prolite:'Pro Lite',team:'Team',business:'Business',enterprise:'Enterprise',edu:'Edu'},claim.chatgpt_plan_type);
  }catch{return null;}
}
let geminiLoggedIn=null;
export async function geminiTier(){
  const exe=path.join(os.homedir(),'.gemini','bin','agy.exe');
  try{
    const {stdout}=await run(exe,['models'],{windowsHide:true,timeout:60000});
    geminiLoggedIn=/gemini-/i.test(stdout);
    const m=stdout.match(/-g1-([a-z]+)\b/i);
    return m?pretty({pro:'Pro',ultra:'Ultra',plus:'Plus',lite:'Lite',basic:'Basic'},m[1]):null;
  }catch(e){geminiLoggedIn=e.code==='ENOENT'?'missing':false;return null;}
}
export function plansFile(){return path.join(appDataDir(),'plans.json');}
export async function detect(){
  const [gemini,gpt,claude]=await Promise.all([geminiTier(),chatgptTier(),claudeTier()]);
  return {gemini,gpt,claude,checked:new Date().toISOString()};
}
// 앱이 백그라운드로 실행: node plan-tiers.mjs → plans.json 갱신
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const result=await detect(),fresh={...result};
  // 못 읽은 서비스는 지난번에 확인한 값을 유지합니다(일시적인 네트워크 문제로 지워지지 않게).
  let previous={};try{previous=JSON.parse(await fs.readFile(plansFile(),'utf8'));}catch{}
  for(const k of ['gemini','gpt','claude'])if(!result[k]&&previous[k])result[k]=previous[k];
  await fs.mkdir(path.dirname(plansFile()),{recursive:true});
  await fs.writeFile(plansFile(),JSON.stringify(result),'utf8');
  // 메뉴 빨간색 표시용 상태: 구독은 로그인 여부, API는 키 유무만 봅니다(요금이 드는 시험 요청은 보내지 않음).
  // 크레딧 부족처럼 실제로 써 봐야 아는 문제는 사용할 때 cloud-brain.mjs가 기록합니다.
  const {record,readHealth}=await import('./brain-health.mjs');
  const health=await readHealth(),updates={};
  updates['sub-gemini']=geminiLoggedIn===true?{ok:true}:{ok:false,reason:geminiLoggedIn==='missing'?'설치 필요':'로그인 필요'};
  updates['sub-gpt']=fresh.gpt?{ok:true}:{ok:false,reason:'로그인 필요'};
  updates['sub-claude']=fresh.claude?{ok:true}:{ok:false,reason:'로그인 필요'};
  const {loadConfig}=await import('./cloud-brain.mjs');
  const config=await loadConfig().catch(()=>null);
  for(const p of ['gemini','gpt','claude']){
    const key='api-'+p,hasKey=Boolean(config?.[p]?.key);
    if(!hasKey){updates[key]={ok:false,reason:'키 없음'};continue;}
    // 키를 새로 저장했으면 예전 실패 기록은 지웁니다(다시 써 봐야 알 수 있음).
    const keyFile=path.join(appDataDir(),p+'.dpapi');
    const changed=await fs.stat(keyFile).then(s=>!health[key]?.at||s.mtimeMs>Date.parse(health[key].at)).catch(()=>false);
    if(changed||health[key]?.reason==='키 없음')updates[key]={ok:true};
  }
  await record(updates);
  console.log(JSON.stringify(result));
}
