// 2026-11-21 사용량 확인 실패 재현: 떠넘기는 답, 지어낸 주소, 작업 브라우저 반복, 최종 점검.
import test from 'node:test';
import assert from 'node:assert/strict';
import {runAutonomousAgent,toExecutorAction} from '../autonomous-core.mjs';
import {usageRequest,AI_USAGE_PAGES} from '../ai-usage.mjs';

const toolCall=(name,args)=>({content:'',tool_calls:[{function:{name,arguments:args}}]});
const answer=content=>({content,tool_calls:[]});
const window={handle:9,pid:4,title:'Claude - Chrome',rect:[0,0,100,100]};
const frame={window,left:0,top:0,width:100,height:100,imageWidth:100,imageHeight:100,image:'aW1n',elements:[],texts:['현재 세션 42% 사용','5시간 후 재설정']};

test('usage requests are recognised, including a follow-up that only says "로그인 되어있잖아"',()=>{
  assert.deepEqual(usageRequest('제미나이 클로드 지피티 사용량하고 남은 한도 알려줘').map(p=>p.id).sort(),['chatgpt','claude','gemini']);
  const recent=[{role:'user',content:'제미나이 클로드 지피티 사용량하고 남은 한도 알려줘'},{role:'assistant',content:'...'}];
  assert.equal(usageRequest('로그인 되어있잖아',recent).length,3);
  assert.equal(usageRequest('클로드로 시 한 편 써줘').length,0);
  assert.equal(usageRequest('메모장 열어줘',[]).length,0);
  for(const p of AI_USAGE_PAGES)assert.ok(!/\/app\/(?:usage|login)/.test(p.url),p.url);
});

test('a usage request gets the real usage pages and the open_page tool from the first turn',async()=>{
  let first;
  await runAutonomousAgent({input:'클로드 사용량 알려줘',execute:async()=>'ok',chatMessage:async({messages,tools})=>{
    first??={text:messages.map(m=>m.content).join('\n'),tools:tools.map(t=>t.function.name)};return answer('네');}});
  assert.match(first.text,/claude\.ai\/settings\/usage/);
  assert.ok(first.tools.includes('open_page')&&first.tools.includes('look'),first.tools.join(','));
  assert.deepEqual(toExecutorAction('open_page',{url:'https://claude.ai/settings/usage'}).tool,'show_page');
});

test('when the work-tab extension is down, browser_open falls back to the user Chrome once and is not repeated',async()=>{
  const actions=[];let i=0;
  const steps=[toolCall('browser_open',{url:'https://claude.ai/settings/usage'}),toolCall('browser_open',{url:'https://claude.ai/settings/usage'}),
    toolCall('browser_read',{}),answer('Claude 현재 세션 42% 사용, 5시간 후 재설정입니다.')];
  let lastTools=[];
  const result=await runAutonomousAgent({input:'클로드 사용량 알려줘',context:{pageLoadMs:0},
    chatMessage:async({tools})=>{lastTools=tools.map(t=>t.function.name);return steps[Math.min(i++,steps.length-1)];},
    execute:async a=>{actions.push(a.tool+(a.text?':'+a.text:''));
      if(a.tool==='browser_open')throw Error('Chrome 작업 탭 확장 연결을 확인해 주세요.');
      return a.tool==='look'?frame:'ok';}});
  // 첫 실패 뒤 같은 주소를 사용자 Chrome에 열고 화면을 읽음. 두 번째 browser_open도 사용자 Chrome으로 바뀜. browser_read는 실행 안 됨.
  assert.equal(actions.filter(a=>a.startsWith('browser_open')).length,1,actions.join(' | '));
  assert.ok(actions.includes('show_page:https://claude.ai/settings/usage'),actions.join(' | '));
  assert.ok(actions.includes('look'),actions.join(' | '));
  assert.ok(!actions.some(a=>a.startsWith('browser_read')),actions.join(' | '));
  assert.ok(!lastTools.includes('browser_open'),'browser tools are hidden after the extension failure');
  assert.equal(result.complete,true);
  assert.doesNotMatch(result.answer,/반복되어 멈췄습니다/);
});

test('final check: a hands-off answer is sent back, then the real result passes',async()=>{
  const steps=[answer('사용량은 각 서비스 설정 > Usage에서 직접 확인하셔야 합니다.'),
    toolCall('open_page',{url:'https://claude.ai/settings/usage'}),answer('Claude: 현재 세션 42% 사용, 5시간 후 재설정.')];
  let i=0;const checks=[];const sent=[];
  const result=await runAutonomousAgent({input:'클로드 사용량 알려줘',context:{pageLoadMs:0,
    verifyRequest:async v=>{checks.push(v);return /42%/.test(v.answer)?{understood:'Claude 사용량 숫자',done:true,missing:''}:{understood:'Claude 사용량 숫자',done:false,missing:'화면에서 읽은 사용량 숫자가 없습니다'};}},
    chatMessage:async({messages})=>{sent.push(messages.at(-1).content);return steps[Math.min(i++,steps.length-1)];},
    execute:async a=>a.tool==='look'?frame:'ok'});
  assert.equal(checks.length,2);
  assert.ok(sent.some(t=>/\(최종 점검\)/.test(String(t))&&/숫자가 없습니다/.test(String(t))),'the missing point is fed back to the model');
  assert.equal(result.complete,true);
  assert.match(result.answer,/42%/);
});

test('final check: if it still fails after two retries the task ends as incomplete with the reason',async()=>{
  const result=await runAutonomousAgent({input:'클로드 사용량 알려줘',context:{pageLoadMs:0,
    verifyRequest:async()=>({understood:'Claude 사용량',done:false,missing:'사용량 숫자 없음'})},
    chatMessage:async()=>answer('사용량은 claude.ai 설정의 Usage 메뉴에서 보실 수 있어요.'),execute:async()=>'ok'});
  assert.equal(result.complete,false);
  assert.match(result.answer,/최종 점검: 요청을 다 끝내지 못했습니다 — 사용량 숫자 없음/);
});

test('final check runs on a plain chat answer when supplied, and nothing changes without a checker',async()=>{
  let called=0;
  await runAutonomousAgent({input:'안녕',context:{verifyRequest:async()=>{called++;return {done:true};}},chatMessage:async()=>answer('안녕하세요!'),execute:async()=>'ok'});
  assert.equal(called,1);
  const plain=await runAutonomousAgent({input:'안녕',chatMessage:async()=>answer('안녕하세요!'),execute:async()=>'ok'});
  assert.equal(plain.complete,true);
});
