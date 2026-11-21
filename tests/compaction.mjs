import test from 'node:test';
import assert from 'node:assert/strict';
import {compactIfNeeded,compactThreshold,pruneOld,recentBoundary} from '../compaction.mjs';
import {estimateTokens} from '../context-size.mjs';
import {runSimpleLoop} from '../simple-loop.mjs';

const big=n=>'가'.repeat(n);

test('the threshold follows OpenClaw: 75% of the window or window minus reserve',()=>{
  assert.equal(compactThreshold(32768),24576);
  assert.equal(compactThreshold(16384),8192);
});

test('nothing changes below the threshold',async()=>{
  const messages=[{role:'system',content:'지시'},{role:'user',content:'요청'}];
  const r=await compactIfNeeded(messages,{window:32768,keepStart:2});
  assert.equal(r.action,'none');assert.equal(messages.length,2);
});

test('old tool output is trimmed first and recent messages stay verbatim',()=>{
  const messages=[{role:'system',content:'지시'},{role:'user',content:big(5000),images:['x']},{role:'user',content:big(5000)}];
  pruneOld(messages,{keepStart:1,keepRecent:1});
  assert.ok(messages[1].content.length<1200);
  assert.equal(messages[1].images,undefined);
  assert.equal(messages[2].content.length,5000);
});

test('a long history is summarized while the start and the recent tail are kept',async()=>{
  const messages=[{role:'system',content:'지시문'},{role:'user',content:'카카오톡으로 보내줘'}];
  for(let i=0;i<40;i++)messages.push({role:'assistant',content:'단계 '+i},{role:'user',content:'결과 '+i+' '+big(900)});
  let seen='';
  const r=await compactIfNeeded(messages,{window:16384,keepStart:2,keepRecentTokens:2000,summarize:async text=>{seen=text;return '메시지를 이미 보냈음. 남은 일 없음.';}});
  assert.equal(r.action,'summarized');
  assert.equal(messages[0].content,'지시문');
  assert.equal(messages[1].content,'카카오톡으로 보내줘');
  assert.match(messages[2].content,/앞선 진행 요약[\s\S]*이미 보냈음/);
  assert.match(messages.at(-1).content,/결과 39/);
  assert.ok(estimateTokens(messages)<=compactThreshold(16384));
  assert.match(seen,/단계 0/);
});

test('a tool call is never separated from its result',()=>{
  const messages=[{role:'system',content:'x'},{role:'assistant',content:'',tool_calls:[{function:{name:'look',arguments:{}}}]},{role:'tool',content:big(4000)},{role:'tool',content:big(100)}];
  const split=recentBoundary(messages,{keepStart:1,keepRecentTokens:50});
  assert.notEqual(messages[split]?.role,'tool');
});

test('the simple loop compacts before asking the model when the window fills',async()=>{
  let turn=0,summaries=0;
  const result=await runSimpleLoop({input:'긴 작업',context:{contextWindow:16384},
    chatMessage:async({messages,tools})=>{
      if(!tools){summaries++;return {content:'앞에서 run을 여러 번 실행함.'};}
      return turn++<12?{tool_calls:[{function:{name:'run',arguments:{command:'echo '+turn}}}]}:{content:'끝났습니다.'};
    },
    execute:async()=>big(3000)});
  assert.equal(result.answer,'끝났습니다.');
  assert.ok(summaries>=1,'요약 호출 '+summaries);
});

import {flushMemory,cleanFlush} from '../compaction.mjs';

test('memory is saved before the old history is summarized, without secrets',async()=>{
  const order=[];let saved=null;
  const messages=[{role:'system',content:'지시문'},{role:'user',content:'요청'}];
  for(let i=0;i<40;i++)messages.push({role:'assistant',content:'단계 '+i},{role:'user',content:'결과 '+i+' '+big(900)});
  await compactIfNeeded(messages,{window:16384,keepStart:2,keepRecentTokens:2000,
    flush:text=>flushMemory(text,{ask:async()=>{order.push('flush');return JSON.stringify({memory:['빠다씨는 카카오톡 "나와의 채팅"으로 테스트한다','비밀번호는 1234이다'],note:'카카오톡 테스트 메시지를 보냄'});},save:async picked=>{saved=picked;}}),
    summarize:async()=>{order.push('summarize');return '요약';}});
  assert.deepEqual(order,['flush','summarize']);
  assert.deepEqual(saved.memory,['빠다씨는 카카오톡 "나와의 채팅"으로 테스트한다']);
  assert.equal(saved.note,'카카오톡 테스트 메시지를 보냄');
});

test('a failed or empty memory flush never blocks compaction',async()=>{
  assert.equal(await flushMemory('x',{ask:async()=>{throw Error('모델 오류');},save:async()=>assert.fail('저장하면 안 됨')}),null);
  let called=false;
  await flushMemory('x',{ask:async()=>JSON.stringify({memory:[],note:''}),save:async()=>{called=true;}});
  assert.equal(called,false);
  assert.deepEqual(cleanFlush({memory:['카드 번호 1234-5678-9012-3456'],note:'토큰 abc 저장'}),{memory:[],note:''});
});

test('past chat turns are cut to a share of the working window, newest first, with long replies shortened',async()=>{
  const {fitRecent}=await import('../compaction.mjs');
  const long='가'.repeat(6000);
  const recent=[{role:'user',content:'첫 요청'},{role:'assistant',content:long},{role:'user',content:'둘째 요청'},{role:'assistant',content:long},{role:'user',content:'셋째 요청'},{role:'assistant',content:long},{role:'user',content:'마지막 요청'}];
  const fitted=fitRecent(recent,8000);
  assert.equal(fitted.at(-1).content,'마지막 요청');
  assert.ok(fitted.length<recent.length,'오래된 것은 뺌: '+fitted.length);
  assert.ok(fitted.every(m=>m.content.length<1200),'긴 답변은 줄임');
  const tokens=fitted.reduce((n,m)=>n+Math.ceil(m.content.length/2),0);
  assert.ok(tokens<=1200,'tokens='+tokens);
  // 한도를 모르면 그대로 둡니다.
  assert.equal(fitRecent(recent,0),recent);
});

test('with a large fixed head, one summary gets below the limit and the next steps do not summarize again',async()=>{
  const {compactIfNeeded}=await import('../compaction.mjs');
  const head=[{role:'system',content:'규칙 '.repeat(13000)}]; // 약 1.9만 토큰 상당의 고정 부분
  const messages=[...head];
  for(let i=0;i<30;i++)messages.push({role:i%2?'user':'assistant',content:'화면 요소 목록 '+'가나다라 '.repeat(120)});
  let summaries=0,flushes=0;const state={};
  const opts={window:32768,keepStart:1,state,summarize:async()=>{summaries++;return '요약';},flush:async()=>{flushes++;}};
  const first=await compactIfNeeded(messages,opts);
  assert.equal(first.action,'summarized');
  assert.ok(first.after<24576,'after summarizing it must be under the limit: '+first.after);
  for(let i=0;i<3;i++){messages.push({role:'assistant',content:'다음 단계 '+'라마바 '.repeat(100)});await compactIfNeeded(messages,opts);}
  assert.equal(summaries,1,'no repeated summaries for small growth');
  assert.equal(flushes,1,'memory is saved once per task');
});
