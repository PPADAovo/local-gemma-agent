import test from 'node:test';
import assert from 'node:assert/strict';
import {runAgentLoop} from '../agent-loop.mjs';

// 카카오톡처럼 요소 목록이 비어 있는 창: 클릭할 때마다 look 결과가 같아 보여도 클릭 뒤 확인은 막으면 안 됩니다.
const look={image:'aGVsbG8=',imageWidth:100,imageHeight:100,elements:[{id:'E1',name:''}],texts:[],window:{title:'카카오톡',handle:1,pid:2,process:'KakaoTalk',rect:[0,0,10,10]}};

test('look after each click is not blocked as a loop even when the screen data looks the same',async()=>{
  const calls=[];let turn=0;
  const steps=[{tool:'click',text:'10,10'},{tool:'look'},{tool:'click',text:'20,20'},{tool:'look'},{tool:'click',text:'30,30'},{tool:'look'},
    {tool:'reply',text:'세 군데를 눌렀습니다.'}].map(s=>({text:'',path:'',thought:'진행',...s}));
  await runAgentLoop({input:'카카오톡 눌러줘',settings:{noSpec:true,toolAllow:['look','click','reply']},maxSteps:20,
    context:{selectedWindow:{handle:1,pid:2,title:'카카오톡'}},
    chat:async(m,f)=>f?.properties?.verified?JSON.stringify({verified:true,quote:'',gap:''}):JSON.stringify(steps[Math.min(turn++,steps.length-1)]),
    execute:async a=>{calls.push(a.tool);return a.tool==='look'?look:{ok:true,window:look.window};}});
  assert.equal(calls.filter(t=>t==='look').length,4,calls.join(','));
  assert.equal(calls.filter(t=>t==='click').length,3,calls.join(','));
});

test('an explanation answer in chat mode is not rejected by the completion check',async()=>{
  let turn=0,verifies=0;
  const steps=[{tool:'windows',text:'',path:'',thought:'창 확인'},{tool:'reply',text:'반복 감지 때문에 멈췄어요. 다시 시도해 주세요.',path:'',thought:'설명'}];
  const result=await runAgentLoop({input:'왜 멈췄어',settings:{toolAllow:['windows','reply']},maxSteps:12,context:{},
    chat:async(m,f)=>{
      if(f?.properties?.kind)return JSON.stringify({kind:'chat',access:'observe',goal:'멈춘 이유 설명',steps:['설명'],criteria:['멈춘 이유를 설명한다'],missing:''});
      if(f?.properties?.verified||f?.properties?.checks||f?.properties?.criteria){verifies++;return JSON.stringify({verified:false,quote:'',gap:'근거 없음',checks:[],missing:'근거 없음',criteria:[]});}
      return JSON.stringify(steps[Math.min(turn++,steps.length-1)]);},
    execute:async()=>({foreground:{title:'로컬 Gemma'},windows:[]})});
  assert.equal(result.complete,true,result.answer);
  assert.match(result.answer,/반복 감지/);
  assert.equal(verifies,0);
});

test('after a click is refused because the window moved, the next look runs instead of being blocked',async()=>{
  const calls=[];let turn=0,refused=false;
  const steps=[{tool:'click',text:'10,10'},{tool:'look'},{tool:'click',text:'10,10'},{tool:'reply',text:'눌렀습니다.'}].map(s=>({text:'',path:'',thought:'진행',...s}));
  await runAgentLoop({input:'카카오톡 눌러줘',settings:{noSpec:true,toolAllow:['look','click','reply']},maxSteps:20,
    context:{selectedWindow:{handle:1,pid:2,title:'카카오톡'}},
    chat:async(m,f)=>f?.properties?.verified?JSON.stringify({verified:true,quote:'',gap:''}):JSON.stringify(steps[Math.min(turn++,steps.length-1)]),
    execute:async a=>{calls.push(a.tool);
      if(a.tool==='click' && !refused){refused=true;throw Error('화면 확인 이후 창 위치나 크기가 바뀌었습니다. look으로 다시 확인하세요.');}
      return a.tool==='look'?look:{ok:true,window:look.window};}});
  // 처음 look → 거절된 click → 다시 look(막히면 안 됨) → 성공한 click
  assert.deepEqual(calls.slice(0,4),['look','click','look','click'],calls.join(','));
});
