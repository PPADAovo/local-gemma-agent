import test from 'node:test';import assert from 'node:assert/strict';import {verifyConditions} from '../completion-check.mjs';
const event=(tool,path,observation)=>({ok:true,tool,path,observation});
const events=[event('read','a.txt','원본 A'),event('read','b.txt','원본 B'),event('read','out.txt','이전 결과'),event('write','out.txt','저장됨'),event('read','out.txt','출력 결과')];
test('planner filenames are advisory and do not replace the original requested outcome',async()=>{
 const r=await verifyConditions({request:['화면을 녹화해 줘'],conditions:['화면을 녹화해 줘'],plannerConditions:['must save desktop_record.mp4'],reply:'capture (2).mp4 저장',events:[event('record_screen','capture (2).mp4','capture (2).mp4 10 seconds')],
 chat:async messages=>{const data=JSON.parse(messages[1].content);assert.deepEqual(data.plannerConditions,['must save desktop_record.mp4']);assert.equal(data.criteria.length,1);return JSON.stringify({checks:[{number:1,met:true,proof:[{id:1,line:1}],gap:''}],missing:''});}});
 assert.equal(r.gap,'');
});
async function evaluate(ids){
  return verifyConditions({events,request:['a.txt와 b.txt를 대조해 저장'],conditions:['결과 저장'],reply:'완료',chat:async()=>JSON.stringify({
    checks:[1,2].map(number=>({number,met:true,proof:ids.map(id=>({id,line:1})),gap:''})),missing:''})});
}
test('source and existing output baseline plus final readback support completion',async()=>assert.equal((await evaluate([1,2,3,5])).gap,''));
test('self-generated output cannot establish source agreement',async()=>assert.match((await evaluate([5])).gap,/원본/));
test('omitting a named comparison input invalidates a pass',async()=>assert.match((await evaluate([1,5])).gap,/b.txt/));
test('old version and invented references cannot verify final state',async()=>{
 assert.match((await evaluate([1,2,3])).gap,/저장 후/);assert.ok((await evaluate([1,2,99])).gap);
});

test('saved screenshot receipt preserves observed window and input control evidence',async()=>{
 await verifyConditions({request:['내 채팅 확인'],conditions:['제목과 입력창 확인'],reply:'확인',events:[{tool:'look',ok:true,observation:'Saved screenshot: capture.jpg',desktopProof:'Window: 내 채팅\nEdit: 메시지 입력'}],chat:async messages=>{
  const data=JSON.parse(messages.at(-1).content),look=data.evidence.find(e=>e.tool==='look');
  assert.match(look.lines.map(l=>l[1]).join('\n'),/Saved screenshot/);
  assert.match(look.lines.map(l=>l[1]).join('\n'),/Edit: 메시지 입력/);
  return JSON.stringify({checks:[{number:1,met:true,proof:[{id:look.id,line:2}],gap:''}],missing:''});
 }});
});

for(const opaque of [false,true])test('runtime trace supports negative constraints only with known execution effects (opaque='+opaque+')',async()=>{
 const events=[event('focus','내 채팅','창 활성화'),{tool:'look',ok:true,observation:'캡처 저장',desktopProof:'내 채팅 / Edit: 메시지 입력 (비어 있음)'}];
 if(opaque)events.unshift(event('run','opaque script','ok'));
 const result=await verifyConditions({request:['메시지 입력 전송 첨부 없이 내 채팅 확인'],conditions:['메시지 입력 전송 첨부 없음'],reply:'확인',events,chat:async messages=>{
  const data=JSON.parse(messages.at(-1).content),trace=data.evidence.find(e=>e.tool==='runtime_trace');
  assert.ok(trace,'runtime dispatch evidence must be supplied');
  assert.equal(trace.lines.length,events.length+1,'complete trace, including events without rich output');
  assert.ok(trace.lines.some(l=>l[1].includes('focus')));
  const look=data.evidence.findLast(e=>e.tool==='look');
  return JSON.stringify({checks:[{number:1,met:true,proof:[{id:trace.id,line:1},{id:look.id,line:1}],gap:''}],missing:''});
 }});
 assert.equal(Boolean(result.gap),opaque,'opaque execution must not prove absence from tool names alone');
});

test('an unsupported citation gets one bounded correction using the same real evidence',async()=>{
 let calls=0;
 const result=await verifyConditions({request:['채팅 입력창 확인, 전송 없음'],conditions:['입력창 확인','전송 없음'],reply:'확인',events:[event('look','','Edit: 메시지 입력')],chat:async(messages,schema)=>{
  calls++;assert.ok(schema.properties.checks.items.properties.proof.items.properties.id.enum.includes(1));
  if(calls===1)return JSON.stringify({checks:[{number:1,met:true,proof:[{id:99,line:0}],gap:''},{number:2,met:true,proof:[{id:-2,line:1}],gap:''}],missing:''});
  assert.match(messages.at(-1).content,/citation|인용/i);
  return JSON.stringify({checks:[{number:1,met:true,proof:[{id:1,line:1}],gap:''},{number:2,met:true,proof:[{id:-2,line:1},{id:1,line:1}],gap:''}],missing:'none'});
 }});
 assert.equal(calls,2);assert.equal(result.gap,'');
});

test('a semantic missing requirement is not retried as a citation formatting problem',async()=>{
 let calls=0;
 const result=await verifyConditions({request:['입력창 확인'],conditions:['입력창 확인'],reply:'',events:[event('look','','제목만 보임')],chat:async()=>{calls++;return JSON.stringify({checks:[{number:1,met:false,proof:[],gap:'입력창 미표시'}],missing:'입력창 미표시'});}});
 assert.equal(calls,1);assert.match(result.gap,/입력창 미표시/);
});

test('evidence keeps repeated lines and does not count a trailing line break as an extra line',async()=>{
  const {verifyConditions}=await import('../completion-check.mjs');
  let supplied;
  await verifyConditions({chat:async(messages)=>{supplied=JSON.parse(messages[1].content).evidence;return JSON.stringify({checks:[{number:1,met:true,proof:[{id:1,line:1}],gap:''}],missing:''});},
    request:['메모.txt가 몇 줄인지 알려줘'],conditions:['줄 수를 정확히 알린다'],reply:'2줄입니다.',
    events:[{tool:'read',ok:true,path:'메모.txt',observation:'같은 줄\n같은 줄\n'}]});
  const lines=supplied.find(e=>e.id===1).lines.map(([,text])=>text);
  assert.deepEqual(lines,['같은 줄','같은 줄']);
});

test('a normal condition proved by a real result is not rejected just because the run log was cited too',async()=>{
  const {verifyConditions}=await import('../completion-check.mjs');
  const result=await verifyConditions({chat:async()=>JSON.stringify({checks:[
      {number:1,met:true,proof:[{id:-2,line:1},{id:1,line:1}],gap:''},
      {number:2,met:true,proof:[{id:-2,line:1},{id:1,line:2}],gap:''}],missing:''}),
    request:['메모.txt가 몇 줄인지 알려줘. 파일은 바꾸지 마'],conditions:['메모.txt 파일이 존재해야 한다','파일을 수정하지 않아야 한다'],reply:'2줄입니다.',
    events:[{tool:'read',ok:true,path:'메모.txt',observation:'첫 줄\n둘째 줄\n'}]});
  assert.equal(result.gap,'',result.gap);
});
