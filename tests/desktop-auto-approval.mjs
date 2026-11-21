import test from 'node:test';
import assert from 'node:assert/strict';
const mod=await import('../desktop-approval.mjs').catch(()=>({}));
const decide=mod.desktopAutoApproval|| (async()=>false);
const frame={window:{handle:7,pid:12,process:'KakaoTalk'},image:'test',elements:[{name:'내 프로필',type:'OcrText',x:20,y:30}]};
const base={mode:'auto',app:{process:'KakaoTalk',action:'click'},request:{action:'click',x:20,y:30,observedHandle:7},frame,task:'나와의 채팅방 열어줘'};
const navigation=async()=>({effect:'navigation',inScope:true,targetConfirmed:true,reason:'내 프로필을 열기'});
test('auto approves grounded navigation in an arbitrary app',async()=>assert.equal(await decide({...base,classify:navigation}),true));
test('auto does not ask for ordinary keyboard navigation',async()=>assert.equal(await decide({...base,app:{...base.app,action:'key'},request:{action:'key',keys:'ctrl+f'},classify:()=>assert.fail('no model needed')}),true));
test('confirm mode still requires confirmation; full keeps its explicit behavior',async()=>{
 assert.equal(await decide({...base,mode:'confirm',classify:navigation}),false);
 assert.equal(await decide({...base,mode:'full',classify:navigation}),true);
});
test('unrelated or stale window and mismatched native event are never auto approved',async()=>{
 for(const change of [{frame:{...frame,window:{...frame.window,handle:8}}},{app:{...base.app,process:'Other'}},{app:{...base.app,action:'type'}}])assert.equal(await decide({...base,...change,classify:navigation}),false);
});
test('side effects, unknown, out of scope and unconfirmed targets do not auto approve',async()=>{
 for(const result of [{effect:'external_commit'},{effect:'destructive'},{effect:'security'},{effect:'unknown'},{effect:'navigation',inScope:false},{effect:'navigation',targetConfirmed:false}])assert.equal(await decide({...base,classify:async()=>({inScope:true,targetConfirmed:true,reason:'test',...result})}),false);
});
test('classifier errors fail closed and named dangerous targets override optimistic model',async()=>{
 assert.equal(await decide({...base,classify:async()=>{throw Error('offline');}}),false);
 assert.equal(await decide({...base,request:{...base.request,elementName:'영구 삭제'},classify:navigation}),false);
});
test('Enter and Space are not unconditional navigation shortcuts',async()=>{
 for(const keys of ['enter','space','ctrl+enter','delete'])assert.equal(await decide({...base,app:{...base.app,action:'key'},request:{action:'key',keys},frame:null,classify:navigation}),false);
});
test('secret input never reaches the classifier',async()=>{
 assert.equal(await decide({...base,app:{...base.app,action:'type'},request:{action:'type',secretText:true},classify:()=>assert.fail('secret classification forbidden')}),false);
});

test('auto respects mode on initial window grants',async()=>{
 const needs=mod.needsWindowGrant||(()=>true);
 assert.equal(needs('auto'),false);assert.equal(needs('full'),false);assert.equal(needs('confirm'),true);
});
test('explicit unlock grant permits only its own native password operation and never calls a classifier',async()=>{
 const grant={handle:7,pid:12,process:'KakaoTalk'};
 const q={...base,app:{process:'KakaoTalk',action:'type',pid:12,handle:7},request:{action:'type',secretText:true,selectedHandle:7,selectedPid:12},unlockGrant:grant,classify:()=>assert.fail('no password to model')};
 assert.equal(await decide(q),true);
 assert.equal(await decide({...q,app:{...q.app,pid:99}}),false);
 assert.equal(await decide({...q,request:{...q.request,secretText:false}}),false);
 assert.equal(await decide({...q,mode:'confirm'}),false);
});

test('unknown or mismatched target requests re-observation rather than asking user to approve a guess',()=>{
 const ask=mod.requiresDesktopConfirmation||(()=>true);
 assert.equal(ask({action:'click'},{effect:'unknown',inScope:false,targetConfirmed:false}),false);
 assert.equal(ask({action:'click'},{effect:'navigation',inScope:false,targetConfirmed:true}),false);
 assert.equal(ask({action:'click'},{effect:'external_commit',inScope:true,targetConfirmed:true}),true);
 assert.equal(ask({action:'click',elementName:'영구 삭제'},null),true);
});

test('classifier sees image-relative coordinates, never desktop offsets',()=>{
 const build=mod.desktopReviewInput||(()=>({}));
 const input=build('친구 탭 열기',{action:'click',x:2033,y:504,selectedHandle:7,observedRect:[2001,447,2393,1129]},{...frame,left:2001,top:447,width:392,height:682,elements:[{name:'친구',type:'Button',x:2033,y:504}]});
 assert.equal(input.input.point.x,32/392*1000);assert.equal(input.input.point.y,57/682*1000);
 assert.equal(input.observed.elements[0].x,input.input.point.x);
 assert.equal(input.input.x,undefined);assert.equal(input.input.observedRect,undefined);
});

test('drag review includes the complete normalized path and rejects stale frame geometry',async()=>{
 const build=mod.desktopReviewInput;
 const f={...frame,left:200,top:100,width:100,height:100,window:{...frame.window,rect:[200,100,300,200]}};
 const r={action:'drag',observedHandle:7,frameWindow:f.window,points:[{x:210,y:120},{x:230,y:140}]};
 assert.deepEqual(build('선택 영역 이동',r,f).input.path,[{x:100,y:200},{x:300,y:400}]);
 const q={...base,app:{...base.app,action:'drag'},request:r,frame:f,classify:navigation};
 assert.equal(await decide(q),true);
 assert.equal(await decide({...q,request:{...r,frameWindow:{...f.window,rect:[200,101,300,201]}}}),false);
 assert.equal(await decide({...q,request:{...r,points:[{x:210,y:120},{x:310,y:140}]}}),false);
});

// 2026-11-20 완화: 이번 작업에 묶은 일반 앱 창의 평범한 입력은 모델 판단 없이 통과(화면 기록이 비어 있어도).
const calc={process:'ApplicationFrameHost',title:'계산기',pid:26588,handle:1638540};
const bound={selectedHandle:1638540,selectedPid:26588};
const noModel=()=>assert.fail('ordinary input in a bound ordinary app must not call the classifier');
test('auto passes ordinary clicks, drags, typing and keys in the bound ordinary app without a model',async()=>{
 for(const request of [{action:'click',x:10,y:10},{action:'click',x:10,y:10,double:true},{action:'click',x:10,y:10,button:'right'},
  {action:'type',text:'1234*56='},{action:'key',keys:'ctrl+z'},{action:'key',keys:'escape'},{action:'scroll'}])
  assert.equal(await decide({mode:'auto',app:{...calc,action:request.action},request:{...request,...bound},frame:null,task:'계산',classify:noModel}),true,JSON.stringify(request));
 const paint={process:'mspaint',title:'제목 없음 - 그림판',pid:21792,handle:4850416};
 assert.equal(await decide({mode:'auto',app:{...paint,action:'drag'},request:{action:'drag',points:[{x:1,y:1},{x:5,y:5}],selectedHandle:4850416,selectedPid:21792},frame:null,task:'선 그리기',classify:noModel}),true);
});
test('relaxation keeps protection for risky keys, multi-line typing, named commits and secrets',async()=>{
 for(const keys of ['enter','space','delete','shift+delete','alt+f4','ctrl+w'])
  assert.equal(await decide({mode:'auto',app:{...calc,action:'key'},request:{action:'key',keys,...bound},frame:null,classify:navigation}),false,keys);
 assert.equal(await decide({mode:'auto',app:{...calc,action:'type'},request:{action:'type',text:'a\nb',...bound},frame:null,classify:navigation}),false);
 for(const elementName of ['삭제','저장 안 함',"Don't save",'결제'])
  assert.equal(await decide({mode:'auto',app:{...calc,action:'click'},request:{action:'click',elementName,...bound},frame:null,classify:navigation}),false,elementName);
 assert.equal(await decide({mode:'auto',app:{...calc,action:'type'},request:{action:'type',secretText:true,...bound},frame:null,classify:noModel}),false);
});
test('relaxation never applies to sensitive apps, other processes or confirm mode',async()=>{
 const cases=[
  {...calc,title:'설정'},{process:'SystemSettings',title:'설정',pid:26588},{process:'KakaoTalk',title:'카카오톡',pid:26588},
  {process:'explorer',title:'문서',pid:26588},{process:'powershell',title:'Windows PowerShell',pid:26588},{process:'firefox',title:'Shop',pid:26588},
  {...calc,pid:999}];
 for(const app of cases){
  let asked=false;
  const result=await decide({mode:'auto',app:{...app,action:'click'},request:{action:'click',x:1,y:1,...bound},frame:null,classify:async()=>{asked=true;return {effect:'navigation',inScope:true,targetConfirmed:true,reason:'x'};}});
  assert.equal(result,false,JSON.stringify(app));assert.equal(asked,false);
 }
 assert.equal(await decide({mode:'confirm',app:{...calc,action:'click'},request:{action:'click',...bound},frame:null,classify:noModel}),false);
});
test('sensitive apps with a current frame still go through the classifier',async()=>{
 let asked=0;
 const result=await decide({...base,request:{...base.request,selectedHandle:7,selectedPid:12},app:{...base.app,pid:12,handle:7},classify:async()=>{asked++;return {effect:'external_commit',inScope:true,targetConfirmed:true,reason:'전송'};}});
 assert.equal(result,false);assert.equal(asked,1);
});
test('an unknown verdict passes only for in-scope input in the bound ordinary app',async()=>{
 const blenderFrame={window:{handle:30,pid:40,process:'blender'},image:'img'};
 const q={mode:'auto',app:{process:'blender',title:'Blender 5.2',action:'key',pid:40,handle:30},request:{action:'key',keys:'enter',observedHandle:30,selectedHandle:30,selectedPid:40},frame:blenderFrame,task:'와인잔 만들어줘 / 직접해줘'};
 const verdict=v=>async()=>({inScope:true,targetConfirmed:false,reason:'불분명',...v});
 assert.equal(await decide({...q,classify:verdict({effect:'unknown'})}),true);
 assert.equal(await decide({...q,classify:verdict({effect:'unknown',inScope:false})}),false);
 assert.equal(await decide({...q,classify:verdict({effect:'destructive'})}),false);
 const kakao={...q,app:{...q.app,process:'KakaoTalk',title:'카카오톡'},frame:{...blenderFrame,window:{...blenderFrame.window,process:'KakaoTalk'}}};
 assert.equal(await decide({...kakao,classify:verdict({effect:'unknown'})}),false);
});
