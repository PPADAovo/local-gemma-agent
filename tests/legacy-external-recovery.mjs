import test from 'node:test';
import assert from 'node:assert/strict';
import {runAgentLoop} from '../agent-loop.mjs';

async function runFailure({localCanRecover=false,localStillFails=false,denied=false,denialCode='USER_HANDOFF_STOP'}={}){
  const recovery=[],executed=[];let count=0;
  const result=await runAgentLoop({input:'작업 자료를 확인해 주세요',maxSteps:8,
    settings:{noSpec:true,computerUse:false,manualHandoff:false,maxIterations:8},
    context:{modelStruggling:async()=>{recovery.push('local');return localCanRecover;},requestExternalAssistance:async reason=>{recovery.push('external');assert.match(reason,/실패|오류/);return true;}},
    chat:async(m,f)=>{
      if(f?.properties?.decision)return JSON.stringify({decision:'stop',reason:'no alternative'});
      if(f?.properties?.tool)return JSON.stringify({tool:'read',path:'missing-'+(++count)+'.txt',text:'0'});
      return '{}';
    },execute:async action=>{executed.push(action);if(localCanRecover&&!localStillFails&&recovery.includes('local'))return '요청한 작업 자료를 읽었습니다: 내용 확인 완료 '+executed.length;throw Object.assign(Error(denied?(denialCode==='USER_HANDOFF_STOP'?'사용자가 작업을 승인하지 않았습니다.':'operation blocked'):'파일 확인 실패'),denied?{code:denialCode}:{});}});
  return {recovery,executed,result};
}
test('legacy repeated failures try stronger local inference before external help without replaying actions',async()=>{
  const {recovery,executed}=await runFailure();
  assert.deepEqual(recovery,['local','external']);
  assert.equal(new Set(executed.map(x=>x.path)).size,executed.length);
});
test('successful local escalation keeps external help unused',async()=>{
  assert.deepEqual((await runFailure({localCanRecover:true})).recovery,['local']);
});

test('stronger local model gets a bounded attempt then persistent failures use external help',async()=>{
  assert.deepEqual((await runFailure({localCanRecover:true,localStillFails:true})).recovery,['local','external']);
});

test('coded permission denial with a generic message stops before recovery',async()=>{
  const r=await runFailure({denied:true,denialCode:'PERMISSION_DENIED'});
  assert.deepEqual(r.recovery,[]);assert.equal(r.executed.length,1);assert.equal(r.result.complete,false);
});
test('user refusal never escalates to another AI',async()=>{
  const r=await runFailure({denied:true});assert.deepEqual(r.recovery,[]);assert.equal(r.executed.length,1);
});
test('mixed mode plans locally before any external spec call',async()=>{
  const executed=[];
  await runAgentLoop({input:'자료를 읽는 방법을 설명해 주세요',settings:{brain:'mix',manualHandoff:false,maxIterations:2},
    chat:async(m,f)=>f?.properties?.goal?JSON.stringify({kind:'chat',goal:'방법 설명',access:'none',desktop:'none',tools:[],steps:[],criteria:[]}):JSON.stringify({tool:'reply',text:'자료를 확인하고 필요한 항목을 읽습니다.',path:''}),
    execute:async a=>{executed.push(a.tool);return '';}});
  assert.ok(!executed.includes('ask_gemini'));
});

test('malformed legacy actions try a stronger local model then one external recovery with existing receipts',async()=>{
  let calls=0;const recoveries=[],executed=[];
  await runAgentLoop({input:'두 자료를 차례로 확인해 주세요',maxSteps:8,settings:{noSpec:true,computerUse:false,manualHandoff:false,maxIterations:8},
    context:{modelStruggling:async()=>{recoveries.push('local');return true;},requestExternalAssistance:async reason=>{assert.match(reason,/JSON/);recoveries.push('external');return true;}},
    chat:async(messages,format)=>{
      if(!format?.properties?.tool)return '{}';
      if(++calls===1)return JSON.stringify({tool:'read',path:'first.txt',text:'0'});
      if(!recoveries.includes('external'))return '{invalid';
      assert.ok(messages.some(m=>String(m.content).includes('FIRST_RECEIPT')),'prior successful observation retained');
      return '{still-invalid';
    },execute:async action=>{executed.push(action.path);return 'FIRST_RECEIPT';}});
  assert.deepEqual(recoveries,['local','external']);assert.deepEqual(executed,['first.txt']);assert.ok(calls<=8);
});

test('a task deadline reached during malformed output never starts external recovery',async()=>{
  let calls=0,external=0;const budget={deadline:Date.now()+10000};
  const result=await runAgentLoop({input:'자료 확인',maxSteps:5,settings:{noSpec:true,computerUse:false,manualHandoff:false,maxIterations:5},
    context:{taskBudget:budget,modelStruggling:async()=>true,requestExternalAssistance:async()=>{external++;return true;}},
    chat:async()=>{if(++calls===3)budget.deadline=Date.now()-1;return '{invalid';},execute:()=>assert.fail('malformed action executed')});
  assert.equal(external,0);assert.equal(result.complete,false);
});
