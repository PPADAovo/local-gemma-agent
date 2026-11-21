import test from 'node:test';
import assert from 'node:assert/strict';
import {runAgentLoop} from '../agent-loop.mjs';

const look={image:'aGVsbG8=',imageWidth:1,imageHeight:1,elements:[],window:{title:'카카오톡',handle:1,pid:2}};

test('a screen tool called as a skill or computer-use plugin runs the real tool',async()=>{
  const calls=[];let turn=0;
  const steps=[
    {tool:'skill',text:'windows',path:'',thought:'창 목록'},
    {tool:'plugin_call',path:'computer-use:look',text:'{"args":{}}',thought:'화면 보기'},
    {tool:'reply',text:'확인했습니다.',path:'',thought:'끝'}];
  await runAgentLoop({input:'열린 창 보여줘',settings:{noSpec:true,toolAllow:['windows','look','plugin_call','skill']},context:{},maxSteps:6,
    chat:async(messages,format)=>format?.properties?.verified?JSON.stringify({verified:true,quote:'',gap:''}):JSON.stringify(steps[Math.min(turn++,steps.length-1)]),
    execute:async action=>{calls.push(action.tool);if(action.tool==='look')return look;if(action.tool==='windows')return {windows:[]};return '';}});
  assert.ok(calls.includes('windows'),'windows 실행: '+calls);
  assert.ok(calls.includes('look'),'look 실행: '+calls);
  assert.ok(!calls.includes('plugin_call'));
});

test('an action written into target runs as that action',async()=>{
  const calls=[];let turn=0;
  const steps=[
    {tool:'look',text:'',path:'',thought:'화면 확인'},
    {tool:'windows',text:'ctrl+f',path:'',target:'key',thought:'검색'},
    {tool:'look',text:'',path:'',target:'click',x:50,y:150,thought:'채팅 탭'},
    {tool:'reply',text:'끝났습니다.',path:'',thought:'끝'}];
  await runAgentLoop({input:'카카오톡에서 ctrl+f 누르고 채팅 탭 클릭해줘',settings:{noSpec:true,toolAllow:['windows','look','key','click']},context:{selectedWindow:{handle:1,pid:2,title:'카카오톡'}},maxSteps:10,
    chat:async(m,format)=>format?.properties?.verified?JSON.stringify({verified:true,quote:'',gap:''}):JSON.stringify(steps[Math.min(turn++,steps.length-1)]),
    execute:async action=>{calls.push(action.tool+':'+(action.text||action.keys||''));if(action.tool==='look')return look;return {ok:true};}});
  assert.ok(calls.some(c=>c==='key:ctrl+f'),'key 실행: '+calls);
});

test('user_action waits for the user and continues after they finish',async()=>{
  const cards=[];let turn=0;
  const steps=[{tool:'user_action',text:'카카오톡 잠금을 풀어 주세요',path:'',thought:'잠금 화면'},{tool:'reply',text:'계속 진행했습니다.',path:'',thought:'끝'}];
  const result=await runAgentLoop({input:'카카오톡 열어줘',settings:{noSpec:true,toolAllow:['look','user_action']},context:{askUser:async card=>{cards.push(card);return '완료했어요';}},maxSteps:6,
    chat:async(m,format)=>format?.properties?.verified?JSON.stringify({verified:true,quote:'',gap:''}):JSON.stringify(steps[Math.min(turn++,steps.length-1)]),
    execute:async action=>action.tool==='look'?look:''});
  assert.equal(cards.length,1);
  assert.match(cards[0].question,/잠금을 풀어/);
  assert.deepEqual(cards[0].options,['완료했어요','작업 중지']);
  assert.notEqual(result.needsInput,true);
});

test('a repeated look with no action in between becomes the key the model described, or is refused',async()=>{
  const calls=[];let turn=0;
  const steps=[
    {tool:'look',text:'',path:'',thought:'화면 확인'},
    {tool:'look',text:'',path:'',thought:'채팅방 검색을 위해 Ctrl+F 키를 누릅니다.'},
    {tool:'look',text:'',path:'',thought:'다시 봅니다'},
    {tool:'look',text:'',path:'',thought:'다시 봅니다'},
    {tool:'look',text:'',path:'',thought:'다시 봅니다'},
    {tool:'look',text:'',path:'',thought:'다시 봅니다'}];
  const result=await runAgentLoop({input:'카카오톡에서 ctrl+f 눌러서 검색창 열어줘',settings:{noSpec:true,toolAllow:['look','key']},context:{selectedWindow:{handle:1,pid:2,title:'카카오톡'}},maxSteps:20,
    chat:async(m,format)=>format?.properties?.verified?JSON.stringify({verified:true,quote:'',gap:''}):JSON.stringify(steps[Math.min(turn++,steps.length-1)]),
    execute:async action=>{calls.push(action.tool+':'+(action.text||''));return action.tool==='look'?look:{ok:true};}});
  assert.ok(calls.includes('key:ctrl+f'),calls.join(','));
  const looks=calls.filter(c=>c.startsWith('look')).length;
  assert.ok(looks<=4,'look 실행 '+looks+'번: '+calls.join(','));
  assert.equal(result.complete,false);
});

test('the default loop warns, blocks, then ends when one call keeps giving the same result',async()=>{
  const calls=[];
  const result=await runAgentLoop({input:'열린 창 목록 확인해줘',settings:{noSpec:true,toolAllow:['windows']},context:{},maxSteps:20,
    chat:async(m,format)=>format?.properties?.verified?JSON.stringify({verified:false,quote:'',gap:''}):JSON.stringify({tool:'windows',text:'',path:'',thought:'창 목록'}),
    execute:async action=>{calls.push(action.tool);return {windows:[{title:'메모장',handle:5,pid:6}]};}});
  assert.ok(calls.filter(c=>c==='windows').length<=3,'windows '+calls.length+'번');
  assert.equal(result.complete,false);
});

test('a desktop app task keeps the screen tools even when the plan mentions plugin_call',async()=>{
  const calls=[];let turn=0;
  const steps=[
    {tool:'skill',text:'',path:'windows',thought:'카카오톡 창 찾기'},
    {tool:'reply',text:'창을 확인했습니다.',path:'',thought:'끝'}];
  await runAgentLoop({input:'카카오톡 나에게 테스트 메시지 보내줘',settings:{toolAllow:['windows','focus','look','click','type','key','skill','plugin_call','reply']},
    context:{askUser:async()=>'작업 중지'},maxSteps:8,
    chat:async(messages,format)=>{
      if(format?.properties?.kind)return JSON.stringify({kind:'action',access:'operate',continuity:'new_topic',surface:'desktop',session:'existing',desktop:'interact',goal:'카카오톡 나와의 채팅에 테스트 메시지 전송',
        skillPlan:[],workflow:'general',externalCapability:'',steps:['카카오톡 창을 연다','메시지를 보낸다'],tools:['open_app','key','click','skill','plugin_call','look'],criteria:['메시지가 보인다'],missing:''});
      if(format?.properties?.verified||format?.properties?.checks)return JSON.stringify({verified:false,quote:'',gap:'미완료',checks:[],missing:'미완료'});
      return JSON.stringify(steps[Math.min(turn++,steps.length-1)]);},
    execute:async action=>{calls.push(action.tool);if(action.tool==='look')return {...look,imageWidth:100,imageHeight:100};if(action.tool==='windows')return {foreground:{title:'카카오톡',handle:1,pid:2,process:'KakaoTalk'},windows:[{title:'카카오톡',handle:1,pid:2,process:'KakaoTalk'}]};return '';}});
  assert.ok(calls.includes('windows'),'windows 실행: '+calls);
});

test('a connected service tool runs even when it was not among the few plugin_search results, and a name put inside text is moved to path',async()=>{
  const calls=[];let turn=0;
  const steps=[
    {tool:'plugin_search',text:'github',path:'',thought:'도구 찾기'},
    {tool:'plugin_call',path:'',text:'{"path":"github.search","query":"throttle","topn":3}',thought:'검색'},
    {tool:'plugin_call',path:'github.fetch_file',text:'{"repository_full_name":"a/b","path":"x.js"}',thought:'읽기'},
    {tool:'reply',text:'찾았습니다.',path:'',thought:'끝'}];
  await runAgentLoop({input:'깃허브에서 throttle 코드 찾아줘',settings:{noSpec:true,toolAllow:['plugin_search','plugin_call']},context:{},maxSteps:10,
    chat:async(m,f)=>f?.properties?.verified?JSON.stringify({verified:true,quote:'',gap:''}):JSON.stringify(steps[Math.min(turn++,steps.length-1)]),
    execute:async a=>{calls.push(a.tool+':'+(a.path||'')+':'+(a.text||''));
      if(a.tool==='plugin_search')return [{name:'local.github.open',description:'열기',inputSchema:{type:'object',properties:{}}},{name:'github.get_repo',description:'저장소',inputSchema:{type:'object',properties:{}}}];
      return '{"ok":true}';}});
  assert.ok(calls.some(c=>c.startsWith('plugin_call:github.search:')&&c.includes('"query":"throttle"')&&!c.includes('"path":"github.search"')),calls.join('\n'));
  assert.ok(calls.some(c=>c.startsWith('plugin_call:github.fetch_file:')),calls.join('\n'));
});

test('a real tool wrapped as a skill or a service call runs directly, with the length taken from the request',async()=>{
  const executed=[];let turn=0;
  const steps=[
    {tool:'skill',text:'record_screen',path:'',thought:'녹화'},
    // 여러 단계 작업의 첫 동작은 '먼저 계획' 안내로 한 번 돌려보내질 수 있어 같은 호출을 한 번 더 둡니다.
    {tool:'skill',text:'record_screen',path:'',thought:'녹화'},
    {tool:'plugin_call',path:'',text:'{"tool":"read","args":{"path":"a.txt","text":"0"}}',thought:'읽기'},
    {tool:'reply',text:'녹화했습니다.',path:'',thought:'끝'}];
  await runAgentLoop({input:'화면 5초 녹화하고 그리고 a.txt도 읽어줘',settings:{noSpec:true,toolAllow:['record_screen','read','skill','plugin_call','plugin_search']},context:{},maxSteps:8,
    chat:async(m,f)=>f?.properties?.verified?JSON.stringify({verified:true,quote:'',gap:''}):JSON.stringify(steps[Math.min(turn++,steps.length-1)]),
    execute:async a=>{executed.push(a.tool+':'+(a.text||'')+':'+(a.path||''));return a.tool==='record_screen'?{file:'a.mp4',bytes:10,seconds:5}:'내용';}});
  assert.ok(executed.includes('record_screen:5:'),executed.join(' | '));
  assert.ok(executed.includes('read:0:a.txt'),executed.join(' | '));
  assert.ok(!executed.some(e=>e.startsWith('skill:')||e.startsWith('plugin_call:')),executed.join(' | '));
});

test('a real tool that is not available this time gets a clear reason instead of a wrong skill error',async()=>{
  const sent=[];let turn=0;
  const steps=[{tool:'skill',text:'record_screen',path:'',thought:'녹화'},{tool:'reply',text:'녹화 도구를 쓸 수 없습니다.',path:'',thought:'끝'}];
  await runAgentLoop({input:'5초짜리 화면 영상 남기고 a.txt도 읽어줘',settings:{noSpec:true,toolAllow:['read','skill']},context:{},maxSteps:6,
    chat:async(m,f)=>{if(f?.properties?.verified)return JSON.stringify({verified:true,quote:'',gap:''});sent.push(String(m.at(-1).content));return JSON.stringify(steps[Math.min(turn++,steps.length-1)]);},
    execute:async a=>{if(a.tool==='skill')assert.fail('스킬로 실행하면 안 됨');return '';}});
  assert.ok(sent.some(t=>/앱 도구 이름인데, 이번 작업에서는 사용할 수 없습니다/.test(t)),sent.join('\n---\n').slice(0,500));
});

test('a service call with arguments but no tool name uses the only looked-up tool that fits those arguments',async()=>{
  const calls=[];let turn=0;
  const steps=[
    {tool:'plugin_search',text:'gmail',path:'',thought:'찾기'},
    {tool:'plugin_search',text:'gmail',path:'',thought:'찾기'},
    {tool:'plugin_call',path:'',text:'{"to":"me","subject":"녹화","body":"영상입니다","files":["a.mp4"]}',thought:'보내기'},
    {tool:'reply',text:'보냈습니다.',path:'',thought:'끝'}];
  await runAgentLoop({input:'a.mp4를 메일로 보내줘',settings:{noSpec:true,toolAllow:['plugin_search','plugin_call']},context:{},maxSteps:8,
    chat:async(m,f)=>f?.properties?.verified?JSON.stringify({verified:true,quote:'',gap:''}):JSON.stringify(steps[Math.min(turn++,steps.length-1)]),
    execute:async a=>{calls.push(a.tool+':'+(a.path||''));
      if(a.tool==='plugin_search')return [
        {name:'gmail.send_attached_email',inputSchema:{type:'object',properties:{to:{},subject:{},body:{},files:{}},required:['to','subject','body']}},
        {name:'gmail.get_profile',inputSchema:{type:'object',properties:{}}}];
      return '{"message_id":"x"}';}});
  assert.ok(calls.includes('plugin_call:gmail.send_attached_email'),calls.join(' | '));
});
