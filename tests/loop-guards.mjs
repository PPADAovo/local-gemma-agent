import assert from 'node:assert/strict';
import test from 'node:test';
import {runAgentLoop} from '../agent-loop.mjs';

const act=(tool,more={})=>({tool,text:'',path:'',thought:'t',...more});

test('repeatedly rejected replies stop honestly instead of looping until the step limit',async()=>{
  let calls=0,planned=false;
  const result=await runAgentLoop({input:'메모를 찾아서 읽어 줘',settings:{noSpec:true,computerUse:false},context:{},maxSteps:40,
    chat:async(m,fmt)=>{calls++;if(fmt?.properties?.checks||fmt?.properties?.verified)return JSON.stringify({verified:false,quote:'',gap:'근거 없음',checks:[],missing:'근거 없음'});
      if(!planned){planned=true;return JSON.stringify(act('plan',{text:'파일 목록 확인\n메모 확인'}));}
      return JSON.stringify(act('reply',{text:'할 일을 전부 끝냈습니다.'}));},
    execute:async()=>'ok'});
  assert.ok(calls<20,'loop should stop early, calls='+calls);
  assert.match(result.answer,/같은 보고가 4번 넘게 반복되어 멈췄습니다/);
  assert.doesNotMatch(result.answer,/전부 끝냈습니다/);
  assert.equal(result.complete,false);
});

test('a successful new action resets the rejected-reply counter',async()=>{
  const script=[act('reply',{text:'a'}),act('reply',{text:'b'}),act('reply',{text:'c'}),act('write',{path:'x.txt',text:'1'}),act('read',{path:'x.txt'}),act('reply',{text:'x.txt에 1을 저장했습니다.'})];
  const result=await runAgentLoop({input:'x.txt에 1 저장해 줘',settings:{noSpec:true,computerUse:false},context:{},maxSteps:12,
    chat:async(m,fmt)=>{if(fmt?.properties?.verified)return JSON.stringify({verified:true,quote:'1',gap:''});return JSON.stringify(script.shift()??act('reply',{text:'x.txt에 1을 저장했습니다.'}));},
    execute:async a=>a.tool==='read'?'1':'저장함'});
  assert.doesNotMatch(result.answer,/반복되어 멈췄습니다/);
});

test('open_file followed by a look counts as the performed input for desktop verification',async()=>{
  const script=[act('open_file',{path:'qa-second.txt'}),act('look'),act('reply',{text:'qa-second.txt를 메모장에서 열었습니다.'})];
  const result=await runAgentLoop({input:'두 번째 파일 열어 줘',settings:{noSpec:true,computerUse:true},context:{},maxSteps:10,
    chat:async(m,fmt)=>{if(fmt?.properties?.verified)return JSON.stringify({verified:true,quote:'qa-second.txt - 메모장',gap:''});if(fmt?.properties?.checks)return JSON.stringify({checks:[{number:1,met:true,proof:[{id:2,line:1}],gap:''}],missing:''});return JSON.stringify(script.shift()??act('reply',{text:'끝'}));},
    execute:async a=>a.tool==='look'?{ok:true,texts:['두번째 파일'],elements:[{name:'텍스트 편집기'}],window:{title:'qa-second.txt - 메모장',process:'Notepad'}}:'기본 프로그램으로 열었습니다: qa-second.txt'});
  assert.doesNotMatch(result.answer,/반복되어 멈췄습니다/);
  assert.match(result.answer,/열었습니다/);
});

test('with a desktop-interact spec, open_file + look lets a true reply finish (was rejected forever)',async()=>{
  const spec={kind:'action',access:'operate',surface:'desktop',session:'any',desktop:'interact',goal:'qa-second.txt가 열려 있어야 함',references:[],deliverable:'',steps:['qa-second.txt 열기'],tools:['open_file'],criteria:['qa-second.txt가 메모장에 열려 있음'],done_when:'qa-second.txt가 열려 있음',missing:''};
  const script=[act('open_file',{path:'qa-second.txt'}),act('look'),act('reply',{text:'qa-second.txt를 메모장에서 열었습니다.'})];
  let replies=0;
  const result=await runAgentLoop({input:'방금 만든 것 중 두 번째 것만 열어 줘',settings:{computerUse:true},context:{},maxSteps:30,
    chat:async(m,fmt)=>{
      const p=fmt?.properties||{};
      if(p.kind&&p.desktop)return JSON.stringify(spec);
      if(p.checks)return JSON.stringify({checks:[{number:1,met:true,proof:[{id:2,line:1}],gap:''}],missing:''});
      if(p.verified)return JSON.stringify({verified:true,quote:'qa-second.txt - 메모장',gap:''});
      if(p.done!==undefined||p.met!==undefined)return JSON.stringify({done:true,met:true,quote:'qa-second.txt - 메모장',reason:''});
      const next=script.shift();if(next)return JSON.stringify(next);replies++;return JSON.stringify(act('reply',{text:'qa-second.txt를 메모장에서 열었습니다.'}));},
    execute:async a=>a.tool==='look'?{ok:true,texts:['두번째 파일'],elements:[{name:'텍스트 편집기'}],window:{title:'qa-second.txt - 메모장',process:'Notepad'}}:a.tool==='windows'?{foreground:{title:'로컬 Gemma',process:'로컬 Gemma'},windows:[]}:'기본 프로그램으로 열었습니다: qa-second.txt'});
  assert.doesNotMatch(result.answer,/반복되어 멈췄습니다|확인하지 못했습니다/,result.answer);
  assert.match(result.answer,/열었습니다/);
  assert.ok(replies<3,'extra rejected replies: '+replies);
});

test('with a desktop-interact spec, run + look lets a true reply finish',async()=>{
  const spec={kind:'action',access:'operate',surface:'desktop',session:'any',desktop:'interact',goal:'qa-second.txt가 열려 있어야 함',references:[],deliverable:'',steps:['qa-second.txt 열기'],tools:['open_file'],criteria:['qa-second.txt가 메모장에 열려 있음'],done_when:'qa-second.txt가 열려 있음',missing:''};
  const script=[act('run',{text:'Start-Process notepad'}),act('look'),act('reply',{text:'qa-second.txt를 메모장에서 열었습니다.'})];
  let replies=0;
  const result=await runAgentLoop({input:'방금 만든 것 중 두 번째 것만 열어 줘',settings:{computerUse:true},context:{},maxSteps:30,
    chat:async(m,fmt)=>{
      const p=fmt?.properties||{};
      if(p.kind&&p.desktop)return JSON.stringify(spec);
      if(p.checks)return JSON.stringify({checks:[{number:1,met:true,proof:[{id:2,line:1}],gap:''}],missing:''});
      if(p.verified)return JSON.stringify({verified:true,quote:'qa-second.txt - 메모장',gap:''});
      if(p.done!==undefined||p.met!==undefined)return JSON.stringify({done:true,met:true,quote:'qa-second.txt - 메모장',reason:''});
      const next=script.shift();if(next)return JSON.stringify(next);replies++;return JSON.stringify(act('reply',{text:'qa-second.txt를 메모장에서 열었습니다.'}));},
    execute:async a=>a.tool==='look'?{ok:true,texts:['두번째 파일'],elements:[{name:'텍스트 편집기'}],window:{title:'qa-second.txt - 메모장',process:'Notepad'}}:a.tool==='windows'?{foreground:{title:'로컬 Gemma',process:'로컬 Gemma'},windows:[]}:'기본 프로그램으로 열었습니다: qa-second.txt'});
  assert.doesNotMatch(result.answer,/반복되어 멈췄습니다|확인하지 못했습니다/,result.answer);
  assert.match(result.answer,/열었습니다/);
  assert.ok(replies<3,'extra rejected replies: '+replies);
});

test('canvas strokes accept the notations the model actually produced in Paint',async()=>{
  const {canvasStrokes,looksLikeCanvas}=await import('../agent-loop.mjs');
  const f={canvas:{left:0,top:0,width:707,height:480}};
  const person='head=ellipse(35,10,65,40)|body=line(50,40;50,70)|left_arm=line(50,40;20,60)|right_arm=line(50,40;80,60)|left_leg=line(50,70;20,90)|right_leg=line(50,70;80,90)';
  assert.ok(looksLikeCanvas(person));
  assert.equal(canvasStrokes(person,f).length,6);
  assert.equal(canvasStrokes('canvas: head=ellipse(250,100,350,200);body=line(300,200;300,350);left_leg=line(300,350;200,450)',f).length,3);
  assert.deepEqual(canvasStrokes('head=ellipse(350,100,650,400)|body=line(500,400;500,700)',f),canvasStrokes('head=ellipse(35,10,65,40)|body=line(50,40;50,70)',f));
  assert.throws(()=>canvasStrokes('a=line(5000,1;2,3)',f),/백분율/);
});

test('a "new window" request turns a focus on the existing app into open_app',async()=>{
  const calls=[];const script=[act('focus',{text:'그림판'}),act('reply',{text:'그림판 새 창을 열었습니다.'})];
  await runAgentLoop({input:'그림판 새 창을 열어 줘',settings:{noSpec:true,computerUse:true},context:{},maxSteps:6,
    chat:async(m,fmt)=>{if(fmt?.properties?.verified)return JSON.stringify({verified:true,quote:'그림판',gap:''});return JSON.stringify(script.shift()??act('reply',{text:'끝'}));},
    execute:async a=>{calls.push(a.tool+':'+(a.text||''));return a.tool==='look'?{ok:true,elements:[],window:{title:'제목 없음 - 그림판',process:'mspaint'}}:'새 창 확인: 제목 없음 - 그림판';}});
  assert.ok(calls.includes('open_app:그림판'),calls.join(','));
  assert.ok(calls.indexOf('open_app:그림판')<calls.findIndex(c=>c.startsWith('focus:'))||!calls.some(c=>c.startsWith('focus:')),calls.join(','));
  assert.ok(!calls.includes('focus:그림판'),calls.join(','));
});

test('new-window conversion extracts the app name from a window title or process name',async()=>{
  for(const [given,expected] of [['제목 없음 - 그림판','그림판'],['mspaint','그림판'],['그림판','그림판']]){
    const calls=[];const script=[act('focus',{text:given}),act('reply',{text:'열었습니다.'})];
    await runAgentLoop({input:'그림판 새 창을 열어 줘',settings:{noSpec:true,computerUse:true},context:{},maxSteps:5,
      chat:async(m,fmt)=>{if(fmt?.properties?.verified)return JSON.stringify({verified:true,quote:'그림판',gap:''});return JSON.stringify(script.shift()??act('reply',{text:'끝'}));},
      execute:async a=>{calls.push(a.tool+':'+(a.text||''));return a.tool==='look'?{ok:true,elements:[],window:{title:'제목 없음 - 그림판',process:'mspaint'}}:'새 창 확인: 제목 없음 - 그림판';}});
    assert.equal(calls[0],'open_app:'+expected,given+' → '+calls.join(','));
  }
});

test('an explicitly selected desktop window is inspected even if the inferred surface says web',async()=>{
  const calls=[];
  const spec={kind:'action',access:'operate',surface:'web',session:'existing',desktop:'none',goal:'일정 저장',references:[],deliverable:'',steps:['일정 저장'],tools:['browser_click'],criteria:['저장됨'],done_when:'저장됨',missing:''};
  await runAgentLoop({input:'선택한 창의 저장 버튼을 클릭해줘',settings:{computerUse:true},context:{selectedWindow:true},maxSteps:1,
    chat:async(messages,format)=>JSON.stringify(format?.properties?.kind?spec:act('reply',{text:'확인'})),
    execute:async action=>{calls.push(action.tool);return {ok:true,elements:[],window:{title:'테스트 달력',process:'fixture',handle:1}};}});
  assert.equal(calls[0],'look');
});

test('scaled capture coordinates stay inside a window on a secondary monitor',async()=>{
  const {capturePoint}=await import('../agent-loop.mjs');
  const frame={left:-1920,top:-48,width:1536,height:959,imageWidth:1024,imageHeight:639};
  assert.deepEqual(capturePoint(frame,512,319.5),{x:-1152,y:432});
  assert.throws(()=>capturePoint(frame,1024,300));
  assert.throws(()=>capturePoint(frame,500,639));
});
test('a casual chat reply with a polite question or "돕겠습니다" ends normally without a card or rejection',async()=>{
  const cards=[];let calls=0;
  const result=await runAgentLoop({input:'안녕하세요',settings:{computerUse:false},context:{askUser:async c=>{cards.push(c);return '작업 중지';}},maxSteps:6,
    chat:async(m,fmt)=>{calls++;
      if(fmt?.properties?.kind)return JSON.stringify({kind:'chat',access:'observe',goal:'인사에 답하기',steps:['인사'],criteria:[],missing:'사용자가 원하는 작업'});
      if(fmt?.properties?.verified||fmt?.properties?.checks)return JSON.stringify({verified:true,quote:'',gap:'',checks:[],missing:''});
      return JSON.stringify(act('reply',{text:'안녕하세요, 빠다씨! 무엇이든 말씀해 주시면 최선을 다해 돕겠습니다. 어떤 도움을 드릴까요?'}));},
    execute:async()=>assert.fail('도구 실행 없음')});
  assert.equal(cards.length,0);
  assert.equal(result.complete,true);
  assert.match(result.answer,/어떤 도움을 드릴까요/);
  assert.ok(calls<=4,'calls='+calls);
});

test('reading a file again after it was saved again is allowed, not blocked as a repeat',async()=>{
  const {runAgentLoop}=await import('../agent-loop.mjs');
  const executed=[];let turn=0;
  const read={tool:'read',text:'0',path:'a.txt',thought:'확인'};
  const steps=[{tool:'write',text:'v1',path:'a.txt',thought:'쓰기'},read,read,read,{tool:'write',text:'v2',path:'a.txt',thought:'고쳐 쓰기'},read,{tool:'reply',text:'a.txt를 v2로 저장했습니다.',path:'',thought:'끝'}];
  await runAgentLoop({input:'a.txt에 v2라고 써줘',settings:{noSpec:true,toolAllow:['write','read','reply']},context:{},maxSteps:14,
    chat:async(m,f)=>f?.properties?.allow!==undefined||f?.properties?.reason?JSON.stringify({allow:true,reason:''}):f?.properties?.verified?JSON.stringify({verified:true,quote:'v2',gap:''}):JSON.stringify(steps[Math.min(turn++,steps.length-1)]),
    execute:async a=>{executed.push(a.tool);return a.tool==='read'?(executed.filter(t=>t==='write').length>1?'v2':'v1'):'저장됨';}});
  const afterSecondWrite=executed.slice(executed.lastIndexOf('write')+1);
  assert.ok(afterSecondWrite.includes('read'),executed.join(','));
});
