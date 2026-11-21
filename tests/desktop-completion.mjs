import test from 'node:test';
import assert from 'node:assert/strict';
import {runAgentLoop} from '../agent-loop.mjs';

for(const met of [true,false])test(`desktop final observation ${met?'completes overlapping steps':'still requires verified criteria'}`,async()=>{
 const window={title:'내 채팅',process:'KakaoTalk',handle:1,pid:2,rect:[0,0,100,100]};
 let turn=0,audits=0;const calls=[];
 const result=await runAgentLoop({input:'내 채팅을 열고 제목과 입력창 확인',maxSteps:5,settings:{toolAllow:['look','double_click','reply']},context:{selectedWindow:window},
 chat:async(messages,schema)=>{
  if(schema.properties.kind)return JSON.stringify({kind:'action',access:'operate',surface:'desktop',desktop:'interact',session:'existing',goal:'내 채팅 확인',steps:['채팅 열기','제목 확인','입력창 확인'],tools:['look','double_click'],criteria:['내 채팅 제목과 입력창 표시'],missing:''});
  if(schema.properties.checks){audits++;const data=JSON.parse(messages.at(-1).content);const e=data.evidence.filter(e=>e.tool==='look').at(-1);assert.match(e.lines.map(l=>l[1]).join('\n'),/Edit: 메시지 입력/,'a long chat transcript must not evict the input control');return JSON.stringify({checks:[{number:1,met,proof:[{id:e.id,line:1}],gap:met?'':'입력창 근거 없음'}],missing:met?'':'입력창 근거 없음',stages:[]});}
  return JSON.stringify(turn++===0?{tool:'double_click',text:'20,20',thought:'내 프로필 열기'}:{tool:'reply',text:'내 채팅 제목과 메시지 입력창을 확인했습니다.'});
 },execute:async a=>{calls.push(a.tool);return a.tool==='look'?{window,image:'aGVsbG8=',left:0,top:0,width:100,height:100,imageWidth:100,imageHeight:100,elements:[{id:1,type:'Edit',name:'메시지 입력',x:20,y:80}],texts:['내 채팅','오래된 채팅 내용 '.repeat(400)]}:{ok:true,window};}});
 assert.ok(audits>0,'must audit actual final observation before demanding checklist bookkeeping');
 assert.equal(result.complete,met);
 assert.equal(calls.filter(x=>x==='double_click').length,1);
});
