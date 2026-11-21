import test from 'node:test';
import assert from 'node:assert/strict';
import {runAgentLoop} from '../agent-loop.mjs';
const window={title:'메모장',process:'notepad',handle:1,pid:2,rect:[0,0,100,100]};
const screen={window,image:'aGVsbG8=',imageWidth:100,imageHeight:100,elements:[],texts:['메모']};
test('focus schedules one screen check without consuming a repeated-look warning',async()=>{
 const logs=[],calls=[];let turn=0;
 const steps=[{tool:'focus',text:'HWND:1'},{tool:'reply',text:'확인했습니다.'}];
 await runAgentLoop({input:'메모장 창 확인해줘',settings:{toolAllow:['focus','look','reply']},context:{selectedWindow:window},log:s=>logs.push(s),
 chat:async(m,f)=>JSON.stringify(f?.properties?.kind?{kind:'action',access:'operate',surface:'desktop',session:'existing',desktop:'interact',goal:'메모장 확인',steps:['화면 확인'],tools:['focus','look'],criteria:[],missing:''}:f?.properties?.verified?{verified:true,quote:'메모',gap:''}:steps[Math.min(turn++,steps.length-1)]),
 execute:async a=>{calls.push(a.tool);return a.tool==='look'?screen:{ok:true,window};}});
 assert.deepEqual(calls,['look','focus','look']);
 assert.ok(!logs.some(s=>s.includes('같은 화면 다시 보기 막음')),logs.join('\n'));
});
test('a shortcut described in a repeated look preserves s and removes whitespace',async()=>{
 const calls=[];let turn=0;
 const steps=[{tool:'look',text:'',thought:'Ctrl + S 키를 누릅니다.'},{tool:'reply',text:'확인했습니다.'}];
 await runAgentLoop({input:'메모장 창 확인해줘',settings:{noSpec:true,toolAllow:['look','key','reply']},context:{selectedWindow:window},
 chat:async(m,f)=>JSON.stringify(f?.properties?.verified?{verified:true,quote:'메모',gap:''}:steps[Math.min(turn++,steps.length-1)]),
 execute:async a=>{calls.push(a);return a.tool==='look'?screen:{ok:true,window};}});
 assert.equal(calls.find(a=>a.tool==='key')?.text,'ctrl+s');
});
