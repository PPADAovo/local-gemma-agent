import test from 'node:test';
import assert from 'node:assert/strict';
import {createLocalFirstPolicy,isLocalFirst,nativeFallbackRequest,nativeFallbackMessage} from '../local-first-runtime.mjs';
test('local-first is default and external provider activates only after concrete failure',()=>{
  assert.equal(isLocalFirst({brain:'sub-gemini'}),true);
  assert.equal(isLocalFirst({localFirst:false}),false);
  const policy=createLocalFirstPolicy({brain:'sub-gemini'});
  assert.equal(policy.external,false);
  assert.equal(policy.escalate('local model failed twice'),true);
  assert.equal(policy.external,true);
  assert.equal(policy.escalate('again'),false);
  policy.reset();assert.equal(policy.external,false);
});
test('no configured provider and explicit disabled external fallback remain local',()=>{
  assert.equal(createLocalFirstPolicy({brain:'local'}).escalate('failed'),false);
  assert.equal(createLocalFirstPolicy({brain:'sub-gemini',externalFallback:false}).escalate('failed'),false);
});
test('stop, permission and deadlines cannot be escalated',()=>{
  for(const reason of [Object.assign(Error('stop'),{name:'AbortError'}),Object.assign(Error('limit'),{code:'TASK_DEADLINE'}),'사용자가 승인을 거부했습니다','permission denied'])assert.equal(createLocalFirstPolicy({brain:'sub-gemini'}).escalate(reason),false);
});
test('local inference timeout can escalate when the overall task remains active',()=>{
  assert.equal(createLocalFirstPolicy({brain:'sub-gemini'}).escalate(Object.assign(Error('local inference timed out'),{name:'TimeoutError'})),true);
});
test('native adapter retains receipts and dispatches only known structured calls',()=>{
  const tools=[{type:'function',function:{name:'read',description:'Read a file',parameters:{type:'object',properties:{path:{type:'string'}},required:['path']}}}];
  const request=nativeFallbackRequest({messages:[{role:'assistant',content:'',tool_calls:[{id:'1',function:{name:'write',arguments:{path:'note.txt',content:'saved'}}}]},{role:'tool',content:'saved',tool_call_id:'1'}],tools});
  assert.equal(request.messages.at(-1).content,'saved');
  assert.match(request.messages[1].content,/note.txt/);
  assert.deepEqual(nativeFallbackMessage('{"content":"","tool_calls":[{"name":"read","arguments_json":"{\\"path\\":\\"note.txt\\"}"}]}',tools).tool_calls[0].function,{name:'read',arguments:{path:'note.txt'}});
  assert.throws(()=>nativeFallbackMessage('{"content":"","tool_calls":[{"name":"delete","arguments_json":"{}"}]}',tools),/도구/);
});
