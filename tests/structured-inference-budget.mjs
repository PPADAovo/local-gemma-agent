import test from 'node:test';
import assert from 'node:assert/strict';
import {createConversation} from '../conversation.mjs';

const response=value=>Response.json({message:{content:JSON.stringify(value)},done_reason:'stop'});
const spec={kind:'chat',access:'observe',continuity:'new_topic',surface:'other',session:'any',desktop:'none',goal:'요청에 답변하기',steps:[],tools:[],criteria:[],done_when:'답변이 전달됨',skillPlan:[],workflow:'general',externalCapability:''};

test('legacy task specification has a bounded structured inference budget without losing its schema',async()=>{
  const calls=[],logs=[];
  const app=createConversation({model:'gemma4:test',settings:{computerUse:false},execute:()=>assert.fail('chat has no action'),context:{log:line=>logs.push(line)},
    localChat:async(payload,timeout,control)=>{calls.push({payload,timeout,control});return response(payload.format?.properties?.kind?spec:{tool:'reply',text:'설명입니다.'});}});
  await app.ask('짧은 설명을 해주세요');
  const first=calls[0];
  assert.equal(first.payload.think,false);
  assert.equal(first.payload.options.num_predict,2048);
  assert.ok(first.timeout<=60000);
  for(const field of ['steps','criteria','skillPlan','goal','missing'])assert.ok(field in first.payload.format.properties,'retain explicit planning fields: '+field);
  assert.ok(logs.some(line=>line.includes('task-spec')&&line.includes('시작')),'timing diagnostics identify the phase before transport begins');
  assert.ok(logs.some(line=>line.includes('task-spec')&&line.includes('완료')));
});

test('legacy final evidence verifier uses explicit JSON reasoning without hidden thinking or a seven-minute timeout',async()=>{
  const calls=[];let read=false;
  const app=createConversation({model:'gemma4:test',settings:{noSpec:true,computerUse:false},execute:async()=>{read=true;return 'observed contents';},
    localChat:async(payload,timeout)=>{calls.push({payload,timeout});return response(payload.format?.properties?.verified?{verified:true,quote:'observed contents',gap:''}:read?{tool:'reply',text:'observed contents'}:{tool:'read',path:'fixture.txt'});}});
  const result=await app.ask('fixture.txt 내용을 읽어 주세요');
  const verification=calls.find(c=>c.payload.format?.properties?.verified);
  assert.ok(verification);assert.equal(verification.payload.think,false);
  assert.equal(verification.payload.options.num_predict,1024);assert.ok(verification.timeout<=60000);
  assert.equal(result.complete,true);
});

test('structured planning output grows only within the phase token cap',async()=>{
  const planning=[];let turn=0;
  const app=createConversation({model:'gemma4:test',settings:{computerUse:false},execute:()=>assert.fail('no action'),localChat:async payload=>{
    if(payload.format?.properties?.kind){planning.push(payload);if(turn++===0)return Response.json({message:{content:'{"kind":"chat"'},done_reason:'length'});return response(spec);}
    return response({tool:'reply',text:'설명입니다.'});
  }});
  await app.ask('짧은 설명을 해주세요');
  assert.deepEqual(planning.map(p=>p.options.num_predict),[2048,4096]);
  assert.deepEqual(planning[1].format,planning[0].format);
});

test('regeneration shares one deadline instead of restarting the whole inference timeout',async t=>{
  let now=100000,generations=0;const calls=[];
  t.mock.method(Date,'now',()=>now);
  const app=createConversation({model:'fixture',attachment:'fixture reference',execute:()=>assert.fail('read only'),localChat:async(payload,timeout,control)=>{
    calls.push({payload,timeout,control});now+=1000;
    return Response.json({message:{content:++generations===1?'partial':'complete'},done_reason:generations===1?'length':'stop'});
  }});
  assert.equal((await app.ask('첨부 자료를 설명해 주세요')).answer,'complete');
  assert.equal(calls.length,2);assert.equal(calls[1].timeout,calls[0].timeout-1000);
  assert.equal(calls[1].control.deadline,calls[0].control.deadline);
  assert.ok(calls[0].control.signal instanceof AbortSignal);
  assert.equal(calls[0].payload.think,undefined,'freeform reasoning policy remains unchanged');
});

test('a local transport timeout remains eligible for configured external recovery',async()=>{
  let external=0;
  const app=createConversation({model:'gemma4:test',settings:{brain:'sub-gemini',loopMode:'simple'},execute:()=>assert.fail('no action'),
    localChat:async()=>{throw new DOMException('The operation was aborted due to timeout','TimeoutError');},
    context:{externalComplete:async()=>{external++;return JSON.stringify({content:'연결된 모델이 응답했습니다.',tool_calls:[]});}}});
  const result=await app.ask('안녕');assert.equal(external,1);assert.equal(result.complete,true);
});
