import {externalCutoutService} from './external-cutout.mjs';

export async function probeCutoutService(request=fetch){
  try{
    const response=await request('https://briaai-bria-rmbg-1-4.hf.space/gradio_api/info',{redirect:'error',signal:AbortSignal.timeout(8000)});
    if(!response.ok)return false;
    return Boolean((await response.json()).named_endpoints?.['/run']);
  }catch{return false;}
}

const stopped=message=>Object.assign(Error(message),{code:'USER_HANDOFF_STOP'});
export async function runCutoutWithFallback({route,execute,canRetry=async()=>true,onRoute=()=>{}}){
  const initial=await chooseCutoutRoute({...route,localFailure:undefined});
  const attempt=async engine=>{onRoute(engine);return execute(engine);};
  try{return await attempt(initial);}
  catch(error){
    const code=String(error?.code||'');
    const message=String(error?.message||error);
    if(initial==='web'||route.canUseWeb===false||error?.name==='AbortError'||
      /^(?:USER_|ABORT|TASK_DEADLINE|EACCES|EPERM)/.test(code)||
      /승인하지|허용하지|거부|취소|중지|권한|permission|denied|cancelled|canceled/i.test(message)||
      !await canRetry(error))throw error;
    const next=await chooseCutoutRoute({...route,localFailure:message});
    if(next===initial||next==='local-auto')throw error;
    return attempt(next); // One explicit alternative, never an unbounded retry chain.
  }
}
export async function chooseCutoutRoute({userText,filename,output,region,canUseWeb,canUseFlat,localFailure,choose,probe=probeCutoutService}){
  const text=String(userText).trim();
  const localOnly=/오프라인|로컬에서만|로컬로만|(?:로컬(?:\s*(?:모델|도구))?|내 PC|이 PC)(?:에서|로)\s*(?:직접\s*)?(?:누끼|배경\s*제거)|(?:업로드|외부 전송|인터넷 사용)\s*(?:없이|하지\s*마)|\blocal(?:ly)? only\b/i.test(text);
  const wantsFlat=/ffmpeg(?:로|를 써| 사용)|use ffmpeg/i.test(text);
  const wantsModel=/is[- ]?net(?:으로|을 써| 사용)|use is[- ]?net/i.test(text);
  const commercial=/(?:상업(?:용|적)?|수익화|유료\s*배포|commercial)/i.test(text.replace(/비상업(?:적|용)?|non[- ]?commercial/gi,''));
  if(localOnly||wantsFlat||wantsModel)return wantsFlat?'ffmpeg':wantsModel?'isnet':'local-auto';
  // The executor supplies a real failed local attempt before external options are offered.
  // Merely having internet access is not evidence that local processing cannot work.
  if(typeof localFailure!=='string'||!localFailure.trim())return 'local-auto';
  const online=canUseWeb && !commercial && await probe();
  const web='BRIA에 이번 사진 업로드 승인',flat='이 PC의 FFmpeg 사용',local='이 PC의 IS-Net 사용',stop='누끼 작업 중지';
  const options=[...(online?[web]:[]),...(canUseFlat?[flat]:[]),local,stop];
  const reason=online?'BRIA 공개 데모 연결 확인 · 무료 비상업 평가용. 선택하면 이 파일을 외부 서비스에 전송합니다.':
    commercial?'상업적 용도에는 BRIA 무료 평가 데모를 사용할 수 없습니다.':canUseWeb?'BRIA 공개 데모의 현재 실행 경로를 확인할 수 없습니다.':'현재 설정에서 인터넷 연결이 꺼져 있습니다.';
  const details=['로컬 처리에서 확인된 문제: '+localFailure.slice(0,500),reason,externalCutoutService.url,'처리할 사진: '+filename,region?'전송 범위: 선택 영역 '+region.join(', '):'전송 범위: 사진 전체','결과: '+output,'FFmpeg는 단색 배경, IS-Net은 자연 사진용입니다. 두 도구는 이 PC에서 사진을 처리합니다.'].join('\n');
  if(!choose)throw stopped('누끼 도구 선택이 필요합니다. '+details);
  const picked=await choose({kind:'question',title:'누끼 도구 선택',question:details,choicesOnly:true,options});
  if(online&&picked===web)return 'web';
  if(canUseFlat&&picked===flat)return 'ffmpeg';
  if(picked===local)return 'isnet';
  throw stopped('누끼 작업을 중지했습니다. 사진을 업로드하지 않았습니다.');
}
