import test from 'node:test';
import assert from 'node:assert/strict';
import * as target from '../window-target.mjs';
import {runSimpleLoop} from '../simple-loop.mjs';
import {runAgentLoop} from '../agent-loop.mjs';

const frame={image:'fixture',imageWidth:600,imageHeight:400,left:100,top:200,width:600,height:400,elements:[],texts:[],window:{handle:7,pid:12,title:'테스트 편집기의 입력 상태',process:'fixture',rect:[100,200,700,600]},focus:{window:7,pid:12,focusPid:12,id:'PRIVATE_RUNTIME_ID',role:'Edit',class:'OS_EditText',editable:false,readOnly:null,valuePattern:false,name:'PRIVATE_NAME',value:'PRIVATE_VALUE',text:'PRIVATE_TEXT'}};
function assertSummary(text){
  assert.match(text,/Focused input:/);assert.match(text,/OS_EditText/);
  assert.match(text,/"editable":false/);assert.match(text,/"pidMatches":true/);
  assert.doesNotMatch(text,/PRIVATE_(NAME|VALUE|TEXT|RUNTIME_ID)/);
}
test('focus summary exposes only capability metadata and distinguishes PID mismatch',()=>{
  assert.equal(typeof target.focusSummary,'function');
  assertSummary(target.focusSummary(frame));
  assert.match(target.focusSummary({...frame,focus:{...frame.focus,focusPid:99}}),/"pidMatches":false/);
  assert.equal(target.focusSummary({}),'');
  assert.equal(target.focusSummary({focus:{available:false}}),'Focused input: unavailable');
});
test('native loop sends safe active-input metadata after a look',async()=>{
  let turns=0,seen=false;
  await runSimpleLoop({input:'입력칸의 상태를 확인해줘',maxSteps:3,execute:async()=>frame,chatMessage:async({messages})=>{
    if(!turns++)return {tool_calls:[{function:{name:'look',arguments:{}}}]};
    const text=messages.map(m=>m.content).join('\n');assertSummary(text);seen=true;
    return {content:'입력칸의 상태를 확인했습니다.'};
  }});
  assert.ok(seen);
});
test('legacy screenshot prompt sends the same safe focus metadata',async()=>{
  let seen=false;
  await runAgentLoop({input:'입력칸의 상태를 확인해줘',settings:{noSpec:true,computerUse:true,toolAllow:['look']},context:{selectedWindow:true},maxSteps:3,execute:async()=>frame,
    chat:async(messages,format)=>{
      if(format?.properties?.verified)return JSON.stringify({verified:true,quote:'테스트 편집기의 입력 상태',gap:''});
      const text=messages.map(m=>m.content).join('\n');assertSummary(text);seen=true;
      return JSON.stringify({tool:'reply',text:'입력칸의 상태를 확인했습니다.',thought:'현재 화면 확인'});
    }});
  assert.ok(seen);
});
