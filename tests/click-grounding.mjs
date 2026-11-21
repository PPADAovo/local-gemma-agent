import test from 'node:test';
import assert from 'node:assert/strict';
import {runAgentLoop} from '../agent-loop.mjs';

test('grounder receives the clean image while planner history keeps only the annotated image',async()=>{
 const window={title:'앱',process:'app',handle:1,pid:2,rect:[0,0,392,682]};
 const screen={window,left:0,top:0,width:392,height:682,imageWidth:392,imageHeight:682,
  image:'annotated-image',cleanImage:'clean-image',elements:[{id:1,name:'친구',type:'OcrText',x:32,y:57}],texts:[]};
 let turn=0,plannerSawImage=false;const groundingImages=[];
 await runAgentLoop({input:'친구 탭 열기',settings:{noSpec:true,toolAllow:['look','click','reply']},context:{selectedWindow:window},maxSteps:4,
  chat:async(messages,schema)=>{
   if(schema.properties.located){groundingImages.push(messages[1].images);return JSON.stringify({located:true,selectedMatches:true,elementId:1,x:82,y:84,label:'친구'});}
   const images=messages.flatMap(m=>m.images||[]);
   plannerSawImage ||= images.includes(screen.image);
   assert(!images.includes(screen.cleanImage));
   assert(!messages.some(m=>String(m.content).includes(screen.cleanImage)));
   return JSON.stringify(schema.properties.verified?{verified:true,quote:'친구',gap:''}:turn++?{tool:'reply',text:'친구 탭을 확인했습니다.'}:{tool:'click',text:'E1',thought:'친구 탭 열기'});
  },execute:async a=>a.tool==='look'?screen:{ok:true,window}});
 assert.deepEqual(groundingImages,[[screen.cleanImage]]);assert(plannerSawImage);
});

for(const located of [true,false])test(`OCR mismatch ${located?'uses visually located icon':'does not click unrelated text'}`,async()=>{
 const window={title:'카카오톡',process:'KakaoTalk',handle:1,pid:2,rect:[2000,400,2392,1082]};
 const screen={window,left:2000,top:400,width:392,height:682,imageWidth:392,imageHeight:682,image:'aGVsbG8=',elements:[{id:4,name:'오픈채팅',type:'OcrText',x:2190,y:457}],texts:['오픈채팅']};
 const calls=[],groundings=[];let turn=0;
 await runAgentLoop({input:'친구 탭을 열어줘',settings:{noSpec:true,toolAllow:['look','click','reply']},context:{selectedWindow:window},maxSteps:5,
 chat:async(messages,schema)=>{
  if(schema?.properties?.located){groundings.push(messages);return JSON.stringify({located,selectedMatches:false,x:32/392*1000,y:57/682*1000,label:'친구 탭 사람 아이콘'});}
  if(schema?.properties?.verified)return JSON.stringify({verified:true,quote:'친구',gap:''});
  return JSON.stringify(turn++===0?{tool:'click',text:'E4',thought:'친구 탭 사람 모양 아이콘을 클릭합니다.'}:{tool:'reply',text:'확인했습니다.'});
 },execute:async a=>{calls.push(a);return a.tool==='look'?screen:{ok:true,window};}});
 assert.equal(groundings.length,1);
 assert.deepEqual(groundings[0][1].images,[screen.image]);
 const clicks=calls.filter(a=>a.tool==='click');
 assert.equal(clicks.length,located?1:0);
 if(located){assert.equal(clicks[0].absX,2032);assert.equal(clicks[0].absY,457);assert.equal(clicks[0].elementName,undefined);assert.equal(clicks[0].elementType,undefined);}
});

test('a matching OCR target retains its measured coordinates',async()=>{
 const window={title:'카카오톡',process:'KakaoTalk',handle:1,pid:2,rect:[0,0,392,682]};
 const screen={window,left:0,top:0,width:392,height:682,imageWidth:392,imageHeight:682,image:'aGVsbG8=',elements:[{id:5,name:'내 프로필',type:'OcrText',x:140,y:120}],texts:[]};
 const calls=[];let turn=0;
 await runAgentLoop({input:'내 프로필 열기',settings:{noSpec:true,toolAllow:['look','click','reply']},context:{selectedWindow:window},maxSteps:4,
 chat:async(m,s)=>JSON.stringify(s?.properties?.located?{located:true,selectedMatches:true,x:900,y:900,label:'내 프로필'}:s?.properties?.verified?{verified:true,quote:'',gap:''}:turn++===0?{tool:'click',text:'E5',thought:'내 프로필 클릭'}:{tool:'reply',text:'확인'}),execute:async a=>{calls.push(a);return a.tool==='look'?screen:{ok:true,window};}});
 assert.equal(calls.find(a=>a.tool==='click')?.absX,140);
});

test('descriptive target does not hide executable coordinates supplied in text',async()=>{
 const window={title:'새 앱',process:'newApp',handle:1,pid:2,rect:[0,0,200,200]};
 const screen={window,left:0,top:0,width:200,height:200,imageWidth:200,imageHeight:200,image:'aW1hZ2U=',elements:[],texts:[]};
 let turn=0;const calls=[];
 await runAgentLoop({input:'왼쪽 메뉴를 클릭해줘',settings:{noSpec:true,toolAllow:['look','click','reply']},context:{selectedWindow:window},maxSteps:6,
 chat:async(m,s)=>JSON.stringify(s?.properties?.verified?{verified:true,quote:'',gap:''}:turn++?{tool:'reply',text:'확인했습니다.'}:{tool:'click',text:'40,40',target:'왼쪽 메뉴 아이콘',thought:'메뉴 열기'}),execute:async a=>{calls.push(a);return a.tool==='look'?screen:{ok:true,window};}});
 const click=calls.find(a=>a.tool==='click');assert.equal(click?.absX,40);assert.equal(click?.absY,40);
});

test('grounder can choose a different measured UI element instead of inventing coordinates',async()=>{
 const window={title:'앱',process:'app',handle:1,pid:2,rect:[0,0,392,682]};
 const screen={window,left:0,top:0,width:392,height:682,imageWidth:392,imageHeight:682,image:'aW1hZ2U=',elements:[{id:1,name:'광고',type:'Button',x:150,y:620},{id:6,name:'내 프로필',type:'OcrText',x:120,y:128}],texts:[]};
 let turn=0;const calls=[];
 await runAgentLoop({input:'내 프로필 열기',settings:{noSpec:true,toolAllow:['look','click','reply']},context:{selectedWindow:window},maxSteps:6,
 chat:async(m,f)=>{
  if(f.properties.located){assert.match(m[1].content,/내 프로필/);return JSON.stringify({located:true,selectedMatches:false,elementId:6,x:75,y:81,label:'내 프로필'});}
  return JSON.stringify(f.properties.verified?{verified:true,quote:'',gap:''}:turn++?{tool:'reply',text:'확인했습니다.'}:{tool:'click',text:'E1',thought:'내 프로필 열기'});
 },execute:async a=>{calls.push(a);return a.tool==='look'?screen:{ok:true,window};}});
 const click=calls.find(a=>a.tool==='click');assert.equal(click?.absX,120);assert.equal(click?.absY,128);assert.equal(click?.elementName,'내 프로필');
});

test('a named standard control matching the intent is clicked without an extra grounding call',async()=>{
 const window={title:'앱',process:'app',handle:1,pid:2,rect:[0,0,400,300]};
 const screen={window,left:0,top:0,width:400,height:300,imageWidth:400,imageHeight:300,image:'aW1hZ2U=',elements:[{id:3,name:'저장',type:'Button',x:210,y:40}],texts:[]};
 let turn=0,groundings=0;const calls=[];
 await runAgentLoop({input:'저장 버튼 눌러',settings:{noSpec:true,toolAllow:['look','click','reply']},context:{selectedWindow:window},maxSteps:5,
 chat:async(m,f)=>{
  if(f?.properties?.located){groundings++;return JSON.stringify({located:true,selectedMatches:true,elementId:3,x:0,y:0,label:'저장'});}
  return JSON.stringify(f?.properties?.verified?{verified:true,quote:'',gap:''}:turn++?{tool:'reply',text:'눌렀습니다.'}:{tool:'click',text:'E3',thought:'저장 버튼을 누릅니다'});
 },execute:async a=>{calls.push(a);return a.tool==='look'?screen:{ok:true,window};}});
 assert.equal(groundings,0);
 const click=calls.find(a=>a.tool==='click');assert.equal(click?.absX,210);assert.equal(click?.absY,40);
});
