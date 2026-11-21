import test from 'node:test';
import assert from 'node:assert/strict';
import * as routes from '../cutout-route.mjs';
const {chooseCutoutRoute,probeCutoutService}=routes;
const request={userText:'토끼 사진 누끼 따줘',filename:'rabbit.jpg',output:'rabbit.png',canUseWeb:true,canUseFlat:true};

test('default photo route attempts local processing without an external probe or upload prompt',async()=>{
 assert.equal(await chooseCutoutRoute({...request,probe:()=>assert.fail('external probe before local attempt'),choose:()=>assert.fail('prompt before local attempt')}),'local-auto');
});

test('after a recorded local failure service discovery sends no image bytes and requires per-file upload choice',async()=>{
 const calls=[];
 const probe=()=>probeCutoutService(async(url,init)=>{calls.push(url);assert.equal(init.body,undefined);assert.equal(init.method,undefined);return Response.json({named_endpoints:{'/run':{}}});});
 const choose=async card=>{assert.equal(card.options[0],'BRIA에 이번 사진 업로드 승인');assert.match(card.question,/rabbit.jpg/);assert.match(card.question,/비상업/);return card.options[0];};
 assert.equal(await chooseCutoutRoute({...request,localFailure:'IS-Net 실행 실패: 로컬 패키지를 사용할 수 없음',probe,choose}),'web');
 assert.equal(calls.length,1);assert.match(calls[0],/\/info$/);
});
test('declining upload stops the workflow instead of sending to another provider or invoking local fallback',async()=>{
 let uploads=0;
 const attempt=async()=>{const engine=await chooseCutoutRoute({...request,localFailure:'로컬 실행 실패',probe:async()=>true,choose:async()=>'누끼 작업 중지'});if(engine)uploads++;};
 await assert.rejects(attempt,e=>e.code==='USER_HANDOFF_STOP');assert.equal(uploads,0);
});
test('recorded local failure still obeys commercial and offline restrictions',async()=>{
 for(const opts of [{userText:'상업용 사진 누끼'},{canUseWeb:false}]){
  const result=await chooseCutoutRoute({...request,...opts,localFailure:'로컬 실행 실패',probe:()=>assert.fail(),choose:async card=>{assert(!card.options.some(x=>x.includes('업로드')));return '이 PC의 FFmpeg 사용';}});
  assert.equal(result,'ffmpeg');
 }
 const local=await chooseCutoutRoute({...request,userText:'사진 업로드 없이 누끼 따줘',probe:()=>assert.fail(),choose:()=>assert.fail()});
 assert.equal(local,'local-auto');
 const down=await chooseCutoutRoute({...request,localFailure:'로컬 실행 실패',probe:async()=>false,choose:async card=>{assert(!card.options.some(x=>x.includes('승인')));return '이 PC의 IS-Net 사용';}});
 assert.equal(down,'isnet');
});

test('local-only request never probes external provider even after a failed local attempt',async()=>{
 assert.equal(await chooseCutoutRoute({...request,userText:'사진 외부 전송 없이 누끼 따줘',localFailure:'로컬 패키지 없음',probe:()=>assert.fail(),choose:()=>assert.fail()}),'local-auto');
});

test('orchestrator uses local result directly without asking an external provider',async()=>{
 const called=[];
 const result=await routes.runCutoutWithFallback({route:{...request,probe:()=>assert.fail(),choose:()=>assert.fail()},execute:async engine=>{called.push(engine);return {model:'isnet'};}});
 assert.deepEqual(called,['local-auto']);assert.equal(result.model,'isnet');
});

test('orchestrator offers external route only after real local error and executes approved route once',async()=>{
 const order=[];
 const result=await routes.runCutoutWithFallback({route:{...request,probe:async()=>{order.push('probe');return true;},choose:async card=>{assert.match(card.question,/local unavailable/);order.push('approve');return card.options[0];}},execute:async engine=>{order.push(engine);if(engine==='local-auto')throw Error('local unavailable');return {model:'bria'};}});
 assert.deepEqual(order,['local-auto','probe','approve','web']);assert.equal(result.model,'bria');
});

test('permission, cancellation and partial outputs cannot trigger external fallback',async()=>{
 for(const error of [Object.assign(Error('stop'),{code:'USER_HANDOFF_STOP'}),Error('사용자가 이 작업을 승인하지 않았습니다.'),Object.assign(Error('cancel'),{name:'AbortError'})]){
  await assert.rejects(()=>routes.runCutoutWithFallback({route:{...request,probe:()=>assert.fail(),choose:()=>assert.fail()},execute:async()=>{throw error;}}),e=>e===error);
 }
 const error=Error('partial output');
 await assert.rejects(()=>routes.runCutoutWithFallback({route:{...request,probe:()=>assert.fail(),choose:()=>assert.fail()},canRetry:async()=>false,execute:async()=>{throw error;}}),e=>e===error);
});

test('failed explicit local request is never rerun or sent outside',async()=>{
 let attempts=0;
 const error=Error('local unavailable');
 await assert.rejects(()=>routes.runCutoutWithFallback({route:{...request,userText:'로컬에서만 누끼 따줘',probe:()=>assert.fail(),choose:()=>assert.fail()},execute:async()=>{attempts++;throw error;}}),e=>e===error);
 assert.equal(attempts,1);
});
