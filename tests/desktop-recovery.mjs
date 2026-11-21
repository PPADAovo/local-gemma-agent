import test from 'node:test';
import assert from 'node:assert/strict';
import {runAgentLoop} from '../agent-loop.mjs';
test('unfamiliar desktop task recovers from repeated observation using a grounded alternate action',async()=>{
 const calls=[];let opened=false,recoveries=0;
 const win={title:'처음 보는 앱',process:'novelApp',handle:42,pid:13,rect:[0,0,100,100]};
 const result=await runAgentLoop({input:'처음 보는 앱의 목록을 열고 확인해줘',maxSteps:15,
  settings:{noSpec:true,toolAllow:['look','key','reply']},context:{selectedWindow:win},
  chat:async(m,f)=>{
   if(f.properties.tool?.enum.includes('ask_user')){recoveries++;assert(m.some(x=>x.images?.length));return JSON.stringify({tool:'key',text:'tab',thought:'관찰한 목록으로 키보드 탐색'});}
   if(f.properties.verified)return JSON.stringify({verified:true,quote:'목록 열림',gap:''});
   return JSON.stringify(opened?{tool:'reply',text:'목록 열림을 확인했습니다.'}:{tool:'look',text:'',thought:'현재 상태 확인'});
  },execute:async a=>{calls.push(a.tool);if(a.tool==='key'){opened=true;return {ok:true,window:win};}return {window:win,image:'aW1hZ2U=',imageWidth:100,imageHeight:100,elements:[],texts:[opened?'목록 열림':'목록']};}});
 assert.equal(recoveries,1);assert(calls.includes('key'));assert.equal(result.complete,true,result.answer);
});

test('a failed native input permits fresh observation even if no successful action was recorded',async()=>{
 const win={title:'앱',process:'app',handle:8,pid:9,rect:[0,0,100,100]};let failed=false,looks=0;
 await runAgentLoop({input:'앱에서 목록 확인',settings:{noSpec:true,toolAllow:['look','key','reply']},context:{selectedWindow:win},maxSteps:8,
  chat:async(m,f)=>JSON.stringify(f.properties.tool?.enum.includes('ask_user')?{tool:'look',text:''}:f.properties.verified?{verified:true,quote:'목록',gap:''}:failed?{tool:'reply',text:'목록을 확인했습니다.'}:{tool:'key',text:'tab'}),
  execute:async a=>{if(a.tool==='key'){failed=true;throw Error('화면 확인 이후 입력 대상 창이 바뀌었습니다.');}looks++;return {window:win,image:'aW1hZ2U=',imageWidth:100,imageHeight:100,texts:['목록'],elements:[]};}});
 assert.equal(looks,2);
});

for(const changesState of [true,false])test(`repeated desktop input ${changesState?'continues after observed progress':'stops despite changing pixels and clock'}`,async()=>{
 const win={title:'Unfamiliar wizard',process:'wizard',handle:42,pid:13,rect:[0,0,100,100]};
 let pressed=0,looks=0,recoveries=0;
 const result=await runAgentLoop({input:'마법사의 세 번째 항목까지 Tab으로 이동하고 확인해줘',maxSteps:16,
  settings:{noSpec:true,toolAllow:['look','key','reply']},context:{selectedWindow:win},
  chat:async(m,f)=>{
   if(f.properties.tool?.enum.includes('ask_user')){recoveries++;return JSON.stringify({tool:'key',text:'tab',thought:'다음 항목으로 이동'});}
   if(f.properties.verified)return JSON.stringify({verified:pressed===3,quote:'현재 항목 3',gap:''});
   return JSON.stringify(pressed<3?{tool:'key',text:'tab',thought:'다음 항목으로 이동'}:{tool:'reply',text:'세 번째 항목을 확인했습니다.'});
  },execute:async a=>{
   if(a.tool==='key'){pressed++;return {ok:true,window:win};}
   looks++;
   const label='현재 항목 '+(changesState?pressed:0);
   return {window:win,left:0,top:0,width:100,height:100,image:'changing-pixels-'+looks,imageWidth:100,imageHeight:100,
    elements:[{id:1,name:label,type:'Button',x:50,y:50}],texts:[label,'12:00:'+String(looks).padStart(2,'0')]};
  }});
 assert.equal(pressed,changesState?3:2);
 assert.equal(result.complete,changesState,result.answer);
 assert.equal(recoveries,changesState?0:1);
});
