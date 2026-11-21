// Only route requests for the actual narration here. An outline, file operation
// or research task mentioning a video still belongs to its usual handler.
const scriptTopic = /대본|나레이션|내레이션|스크립트|narration|script\b/iu;
const lengthHint = /\d[\d.,]*\s*(?:분|시간|자|천\s*자|만\s*자|min(?:ute)?s?\b|hours?\b)|(?:한|두|세|반)\s*시간|장편|장문|한시간/iu;
const continuation = /^(?:(?:네|응|그래)[,.!\s]*)?(?:계속|이어서|진행|시작|작성|완성|마저|끝까지|다음\s*(?:부분|단계|섹션)|해\s*줘|좋아|응|네|그래|go ahead|continue)\s*(?:해서|해|하자|작성|써|해줘|줘|주세요|해봐|주세요)?[.!\s]*$/iu;

export function mightRequestScript(input){
  return (scriptTopic.test(input) && lengthHint.test(input)) || continuation.test(input.trim());
}

export async function resolveScriptRequest(input,recent,generate){
  const priorReply=recent.at(-1);
  const previous = priorReply?.scriptDraft?.input ?? recent.filter(m=>m.role==='user').at(-1)?.content ?? '';
  const resume = continuation.test(input.trim()) && scriptTopic.test(previous) && lengthHint.test(previous)
    && recent.at(-1)?.scriptComplete !== true;
  const request = resume ? previous+'\n'+input : input;
  if (!scriptTopic.test(request) || !lengthHint.test(request)) return null;

  const format={type:'object',properties:{
    fullNarration:{type:'boolean'},minutes:{type:'number'}
  },required:['fullNarration','minutes']};
  const raw=await generate({format,maxTokens:120,messages:[
    {role:'system',content:'Classify the request for routing. fullNarration=true when the user wants the full spoken script written in the chat now, including when they also want an outline as a step. False for outline-only, summarizing an existing video, advice, software scripts, or requests requiring external actions such as making a file, searching online, or rendering video. A video duration gives the length of a spoken script, not a request to render video unless explicitly asked. minutes is requested spoken duration (1 hour = 60 minutes); use 0 if stated only as a character count or unspecified. Return JSON only.'},
    {role:'user',content:request}
  ]});
  const decision=JSON.parse(raw);
  if(decision.fullNarration!==true) return null;
  const minutes=Number(decision.minutes);
  return {input:request,minutes:Number.isFinite(minutes)&&minutes>0?minutes:undefined,
    initialAnswer:resume ? priorReply?.scriptDraft?.answer ?? '' : ''};
}
