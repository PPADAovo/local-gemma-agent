import test from 'node:test';
import assert from 'node:assert/strict';
import {createConversation} from '../conversation.mjs';

test('a selected external provider is fallback: successful local action never calls it',async()=>{
  let local=0,external=0;
  const app=createConversation({model:'gemma4:test',settings:{brain:'sub-gemini',loopMode:'simple'},
    localChat:async()=>{local++;return Response.json({message:{content:'로컬에서 답했습니다.'},done_reason:'stop'});},
    execute:()=>assert.fail('no action'),context:{externalComplete:async()=>{external++;return '{}';}}});
  const result=await app.ask('안녕');
  assert.equal(result.answer,'로컬에서 답했습니다.');assert.equal(local,1);assert.equal(external,0);
});

test('external fallback receives executed tool receipts and never replays a write',async()=>{
  let local=0,external=0;const actions=[];
  const app=createConversation({model:'gemma4:test',settings:{brain:'sub-gemini',loopMode:'simple'},
    localChat:async()=>{if(local++===0)return Response.json({message:{tool_calls:[{id:'save',function:{name:'write',arguments:{path:'note.txt',content:'완료'}}}]},done_reason:'stop'});throw Error('local inference unavailable');},
    execute:async a=>{actions.push(a);return 'saved note.txt';},context:{externalComplete:async({messages,format})=>{
      external++;assert.ok(format.properties.tool_calls);assert.ok(messages.some(m=>m.role==='tool'&&m.content.includes('saved note.txt')));
      return JSON.stringify({content:'파일을 저장했습니다.',tool_calls:[]});
    }}});
  const result=await app.ask('note.txt 파일을 작성해 주세요');
  assert.equal(result.complete,true);assert.equal(actions.length,1);assert.equal(actions[0].tool,'write');assert.equal(external,1);
});

test('fallback native actions route through the same executor',async()=>{
  let external=0;const actions=[];
  const app=createConversation({model:'gemma4:test',settings:{brain:'sub-gemini',loopMode:'simple'},
    localChat:async()=>{throw Error('local unavailable');},execute:async a=>{actions.push(a);return 'file contents';},
    context:{externalComplete:async()=>++external===1?JSON.stringify({content:'',tool_calls:[{name:'read',arguments_json:'{"path":"note.txt"}'}]}):JSON.stringify({content:'파일을 읽었습니다.',tool_calls:[]})}});
  const result=await app.ask('note.txt 파일 내용을 확인해 주세요');
  assert.equal(result.complete,true);assert.deepEqual(actions.map(a=>a.tool),['read']);
});

test('cancellation and permission denial never trigger external escalation',async()=>{
  for(const error of [Object.assign(Error('cancelled'),{name:'AbortError'}),Object.assign(Error('permission denied'),{code:'PERMISSION_DENIED'})]){
    let external=0;
    const app=createConversation({model:'gemma4:test',settings:{brain:'sub-gemini',loopMode:'simple'},localChat:async()=>{throw error;},
      execute:()=>assert.fail('no action'),context:{externalComplete:async()=>{external++;return '{}';}}});
    const result=await app.ask('파일을 확인해 주세요');assert.equal(result.complete,false);assert.equal(external,0);
  }
});

test('malformed external tool arguments never reach execution',async()=>{
  const app=createConversation({model:'gemma4:test',settings:{brain:'sub-gemini',loopMode:'simple'},localChat:async()=>{throw Error('local unavailable');},
    execute:()=>assert.fail('invalid action'),context:{externalComplete:async()=>JSON.stringify({content:'',tool_calls:[{name:'read',arguments_json:'not JSON'}]})}});
  await assert.rejects(app.ask('note.txt 파일을 읽어 주세요'),/JSON|입력|응답/);
});

test('empty local inference retries locally before asking the external provider',async()=>{
  let local=0,external=0;
  const app=createConversation({model:'gemma4:test',settings:{brain:'sub-gemini',loopMode:'simple'},
    localChat:async()=>{local++;return Response.json({message:{content:''},done_reason:'stop'});},execute:()=>assert.fail('no action'),
    context:{externalComplete:async()=>{external++;return JSON.stringify({content:'응답했습니다.',tool_calls:[]});}}});
  const result=await app.ask('안녕');
  assert.equal(result.answer,'응답했습니다.');assert.equal(local,2);assert.equal(external,1);
});
