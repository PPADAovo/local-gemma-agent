import test from 'node:test';
import assert from 'node:assert/strict';
import {runAgentLoop} from '../agent-loop.mjs';

test('unrelated successful observation cannot complete a later delivery step',async()=>{
  const actions=[{tool:'plan',text:'파일 확인\n메일 발송'}, {tool:'list',text:''}, {tool:'check',text:'2'}];
  const result=await runAgentLoop({input:'파일을 확인하고 메일로 보내 줘',settings:{noSpec:true,toolAllow:['list','plan','check','reply']},context:{},maxSteps:3,
    chat:async(_m,f)=>JSON.stringify(f?.properties?.quote?{quote:''}:actions.shift()),
    execute:async()=> 'report.txt'});
  assert.equal(result.events.find(e=>e.tool==='check')?.ok,false);
  assert.equal(result.complete,false);
});

test('a successful directory listing cannot prove the current send step',async()=>{
 const actions=[{tool:'list',text:''},{tool:'check',text:'1'}];
 const result=await runAgentLoop({input:'메일을 보내고 결과를 알려 줘',settings:{computerUse:false},context:{},maxSteps:2,
 chat:async(_m,f)=>JSON.stringify(f?.properties?.goal?{kind:'action',access:'operate',goal:'메일 발송',surface:'other',desktop:'none',steps:['메일 발송','결과 보고'],tools:['list'],criteria:['메일 발송']}:f?.properties?.quote?{quote:''}:actions.shift()),execute:async()=> 'report.txt'});
 assert.equal(result.events.find(e=>e.tool==='check')?.ok,false);
});

test('large discovery metadata preserves read-only repeat calls',async()=>{
  const specs=[{name:'calendar.search',description:'x'.repeat(7000),annotations:{readOnlyHint:true},inputSchema:{type:'object',properties:{}}}];
  const actions=[{tool:'plugin_search',text:'calendar'},{tool:'plugin_call',path:'calendar.search',text:'{}'},{tool:'plugin_call',path:'calendar.search',text:'{}'}];
  let reads=0;const logs=[];
  await runAgentLoop({input:'캘린더를 조회해 줘',settings:{noSpec:true},context:{},maxSteps:3,log:s=>logs.push(s),
    chat:async()=>JSON.stringify(actions.shift()),execute:async a=>{if(a.tool==='plugin_search')return specs;reads++;return '일정 조회 완료';}});
  assert.equal(reads,2);
  assert(!logs.some(s=>s.includes('메타데이터를 읽지 못')));
});

test('three unsuccessful tool operations request model escalation once',async()=>{
 let switches=0,turn=0;
 await runAgentLoop({input:'문서들을 찾아 줘',settings:{noSpec:true,toolAllow:['list','reply']},context:{modelStruggling:async()=>{switches++;return true;}},maxSteps:5,
 chat:async(_m,f)=>JSON.stringify(f?.properties?.decision?{decision:'stop'}:{tool:'list',path:'missing-'+turn++,text:''}),
 execute:async()=>{throw Error('경로를 찾을 수 없습니다');}});
 assert.equal(switches,1);
});

test('non-retryable service failure stops without fabricated delivery or blind recovery',async()=>{
  let calls=0;const logs=[];
  const result=await runAgentLoop({input:'메일 보내 줘',settings:{noSpec:true},context:{},maxSteps:4,log:s=>logs.push(s),
    chat:async()=>JSON.stringify({tool:'plugin_call',path:'gmail.send_message',text:'{}'}),
    execute:async()=>{calls++;throw Error('HTTP status: 429. Retryable: no. Check Gmail for the result before retrying');}});
  assert.equal(calls,1);
  assert.equal(result.complete,false);
  assert.match(result.answer,/429/);
  assert.doesNotMatch(result.answer,/보냈습니다/);
  assert(!logs.some(s=>/멈추지 말고|다른 방법.*다시 시도/.test(s)));
});
