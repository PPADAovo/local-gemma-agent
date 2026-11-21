import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyConditions} from '../completion-check.mjs';
import {requestedPlanApproval,planNotice,announceWork,auditWork} from '../work-progress.mjs';

test('showing the opening plan does not imply a request for approval',()=>{
  assert.equal(requestedPlanApproval('처음에 방법과 단계를 말하고 시작해'),false);
  assert.equal(requestedPlanApproval('계획 승인을 받을 때까지 기다려'),true);
  assert.equal(planNotice('작업 계획을 사용자에게 보고 및 승인'),true);
  assert.equal(planNotice('발송 전 사용자 승인을 요청'),false);
});
test('a different use of the same tool does not prove a missing stage',async()=>{
  const stages=['입고 수량 확인','출고 수량 확인'];
  const events=[{ok:true,tool:'read',path:'입고.txt',observation:'입고 6개'},{ok:true,tool:'read',path:'별도.txt',observation:'확인 대기'}];
  const r=await verifyConditions({chat:async()=>JSON.stringify({checks:[{number:1,met:true,proof:[{id:1,line:1}]}],stages:[{number:1,id:1,quote:'입고 6개'},{number:2,id:2,quote:'출고 3개'}],missing:''}),request:['재고 확인'],conditions:['입고 확인'],reply:'입고 6개',events,stages});
  const messages=[];const send=x=>messages.push(x);const plan=announceWork(send,['read'],stages);
  auditWork(send,plan,events,true,r,r.stageChecks);
  assert.match(messages.at(-1),/입고 수량 확인 — 확인 #1/);
  assert.match(messages.at(-1),/출고 수량 확인 — 실행 근거 미확인/);
});
test('explicitly requested plan approval can stop before any side effect',async()=>{
  const {runAgentLoop}=await import('../agent-loop.mjs');
  const calls=[],progress=[];
  const result=await runAgentLoop({input:'계획 승인을 받을 때까지 기다려. 완료하면 파일을 저장해.',settings:{computerUse:false},
    context:{askUser:async card=>{assert.equal(card.title,'작업 계획 승인');return '작업 중지';}},
    chat:async()=>JSON.stringify({kind:'action',goal:'파일 저장',steps:['파일 작성'],tools:['write'],criteria:['파일 저장 확인'],desktop:'none',surface:'other'}),
    execute:async action=>{calls.push(action.tool);},progress:value=>progress.push(value)});
  assert.deepEqual(calls,[]);assert.equal(result.complete,false);assert.ok(progress.some(x=>x.startsWith('작업 계획 · ')));
});
test('the announcement can prove announcing, never writing',async()=>{
  const resp=await verifyConditions({stages:['일정 저장'],request:['계획 말한 뒤 저장'],conditions:['실제 파일이 저장됨'],reply:'완료',events:[],
    chat:async()=>JSON.stringify({checks:[{number:1,met:true,proof:[{id:0,line:1}]}],stages:[],missing:''})});
  assert.ok(resp.gap);
});

test('trying an installed skill loads its actual guide before choosing a model action',async()=>{
  const {runAgentLoop}=await import('../agent-loop.mjs');
  const calls=[];
  const result=await runAgentLoop({input:'[sample] 도움말을 읽고 간단히 답해줘.',settings:{noSpec:true,toolAllow:['skill','reply'],skillsForRequest:async()=>[{name:'sample',description:'도움말'}]},
    context:{},execute:async action=>{calls.push(action);return '기능 안내: 카드 예시는 보라색입니다.';},
    chat:async(_,schema)=>JSON.stringify(schema.properties.verified?{verified:true,quote:'카드 예시는 보라색입니다.',gap:''}:{tool:'reply',text:'카드 예시는 보라색입니다.',path:''})});
  assert.equal(calls[0]?.tool,'skill');assert.equal(calls[0]?.text,'sample');assert.match(result.answer,/보라색/);
});
test('final rendered photo does not mark unrelated planned steps as executed',async()=>{
  const {photoPlanEvidence}=await import('../agent-loop.mjs');
  const events=[{ok:true,tool:'photo_cutout',path:'rabbit.jpg',observation:'transparentPixels=12345'},{ok:false,tool:'write',path:'notes.txt',observation:'saved'},{ok:true,tool:'browser_preview',path:'index.html',observation:'미리보기 정상'}];
  const stages=['토끼 누끼 추출','관련 메모 파일 저장','결과 렌더링'];
  const result=await photoPlanEvidence(async()=>JSON.stringify({checks:[{stage:1,id:1,quote:'transparentPixels=12345'},{stage:2,id:2,quote:'saved'},{stage:3,id:3,quote:'미리보기 정상'}]}),events,stages);
  assert.deepEqual([...result.keys()],[stages[0],stages[2]]);
});
