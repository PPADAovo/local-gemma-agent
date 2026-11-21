import test from 'node:test';
import assert from 'node:assert/strict';
import * as runtime from '../local-first-runtime.mjs';

test('standalone task generation uses local success and resumes externally only after local failure',async()=>{
  assert.equal(typeof runtime.createTaskCompletion,'function');
  const calls=[];let fail=false;
  const generate=runtime.createTaskCompletion({settings:{brain:'sub-gemini'},
    local:async payload=>{calls.push(['local',payload]);if(fail)throw Error('local unavailable');return 'local';},
    external:async(payload,provider,control)=>{calls.push(['external',payload,provider,control]);return 'external';}});
  const planning={messages:[{role:'user',content:'계획 작성'}]},draft={messages:[{role:'user',content:'대본의 다음 부분'}],maxTokens:220};
  assert.equal(await generate(planning),'local');fail=true;
  assert.equal(await generate(draft,{deadline:Date.now()+5000}),'external');
  assert.equal(await generate(draft),'external');
  assert.deepEqual(calls.map(c=>c[0]),['local','local','external','external']);
  assert.equal(calls[2][1],draft);assert.equal(calls[2][2],'sub-gemini');assert.ok(calls[2][3].deadline>Date.now());
});

test('task generation cancellation, expired task, permission failure and policy checks never call external AI',async()=>{
  assert.equal(typeof runtime.createTaskCompletion,'function');
  for(const error of [Object.assign(Error('user stopped'),{name:'AbortError'}),Object.assign(Error('blocked'),{code:'PERMISSION_DENIED'}),Object.assign(Error('expired'),{code:'TASK_DEADLINE'})]){
    const generate=runtime.createTaskCompletion({settings:{brain:'sub-gemini'},local:async()=>{throw error;},external:()=>assert.fail('must not call external')});
    await assert.rejects(generate({messages:[]}),e=>e===error);
  }
  let local=0;
  const generate=runtime.createTaskCompletion({settings:{brain:'sub-gemini'},local:async()=>{local++;return 'local';},external:()=>assert.fail('must not call external')});
  await assert.rejects(generate({messages:[]},{deadline:Date.now()-1}),{code:'TASK_DEADLINE'});
  await assert.rejects(generate({messages:[]},{signal:AbortSignal.abort()}),{name:'AbortError'});assert.equal(local,0);
});

test('standalone generation honors disabled fallback and explicit external mode',async()=>{
  assert.equal(typeof runtime.createTaskCompletion,'function');
  const disabled=runtime.createTaskCompletion({settings:{brain:'sub-gemini',externalFallback:false},local:async()=>{throw Error('offline');},external:()=>assert.fail('disabled')});
  await assert.rejects(disabled({messages:[]}),/offline/);
  const direct=runtime.createTaskCompletion({settings:{brain:'sub-gemini',localFirst:false},local:()=>assert.fail('explicit external'),external:async()=> 'external'});
  assert.equal(await direct({messages:[]}),'external');
});
