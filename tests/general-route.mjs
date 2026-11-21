import assert from 'node:assert/strict';
import test from 'node:test';
import {runAgentLoop} from '../agent-loop.mjs';
const act=(tool,text='',path='')=>({tool,text,path,thought:'작업'});
test('a proposed question becomes a read of the file already named by the user',async()=>{
 const calls=[];
 const result=await runAgentLoop({input:'그 파일에서 회의 시간을 읽어줘',recent:[{role:'user',content:'회의록은 notes.txt야'}],settings:{noSpec:true},context:{askUser:()=>assert.fail('redundant question')},
 chat:async(messages,fmt)=>{
  if(fmt.properties.tool?.enum.includes('ask_user')){assert.match(messages.at(-1).content,/notes.txt/);return JSON.stringify(act('read','','notes.txt'));}
  if(fmt.properties.verified)return JSON.stringify({verified:true,quote:'오후 두 시',gap:''});
  return JSON.stringify(calls.length?act('reply','오후 두 시입니다.'):{...act('reply','어떤 파일을 읽을까요?'),needsInput:true});
 }, execute:async action=>{calls.push(action.path);return '오후 두 시';}});
 assert.deepEqual(calls,['notes.txt']);assert.ok(result.complete);
});
test('a failed file route changes to a directory lookup and preserves the eventual result',async()=>{
 const calls=[];
 const result=await runAgentLoop({input:'회의록 열람',settings:{noSpec:true},context:{},chat:async(messages,fmt)=>{
  if(fmt.properties.tool?.enum.includes('ask_user')){assert.match(messages.at(-1).content,/not found/);return JSON.stringify(act('list'));}
  if(fmt.properties.verified)return JSON.stringify({verified:true,quote:'회의 본문',gap:''});
  return JSON.stringify(calls.length===0?act('read','','old.txt'):calls.length===2?act('read','','new.txt'):act('reply','회의 본문'));
 },execute:async a=>{calls.push(a.tool);if(a.path==='old.txt')throw Error('not found');return a.tool==='list'?'new.txt':'회의 본문';}});
 assert.deepEqual(calls,['read','list','read']);assert.ok(result.complete);
});
test('only the unresolved choice gets a user card',async()=>{
 let asked=0;
 const result=await runAgentLoop({input:'두 초안 중 하나 선택',settings:{noSpec:true},context:{askUser:async card=>{assert.match(card.question,/어느 초안/);asked++;return '작업 중지';}},
 chat:async(_m,f)=>JSON.stringify(f.properties.tool?.enum.includes('ask_user')?act('ask_user','내용이 다른 두 문서 중 어느 초안을 사용할까요?'):{...act('reply','어느 초안으로 할까요?'),needsInput:true}),execute:()=>assert.fail()});
 assert.equal(asked,1);assert.equal(result.complete,false);
});
test('a lookup can finish once its answer and original target are verified',async()=>{
 const calls=[];
 const result=await runAgentLoop({input:'어제 회의록에서 다음 날짜를 찾아줘',settings:{toolAllow:['read','list']},context:{},
 chat:async(_m,f)=>{
  if(f.properties.kind)return JSON.stringify({kind:'action',desktop:'none',session:'any',access:'observe',goal:'다음 날짜 확인',steps:['회의록 읽기','다음 날짜 보고'],done_when:'날짜 보고'});
  if(f.properties.checks)return JSON.stringify({checks:[{number:1,met:true,proof:[{id:1,line:1}],gap:''}],missing:''});
  return JSON.stringify(calls.length?act('reply','금요일입니다.'):act('read','','회의록.txt'));
 },execute:async a=>{calls.push(a.tool);return '다음 모임은 금요일';}});
 assert.deepEqual(calls,['read']);assert.equal(result.complete,true);
});

test('desktop operation inspects windows before handing the task back',async()=>{
 const calls=[];
 const result=await runAgentLoop({input:'받은편지함 열어줘',settings:{toolAllow:['windows','look','focus','reply']},context:{askUser:async()=> '작업 중지'},
 chat:async(_m,f)=>{
  if(f.properties.kind)return JSON.stringify({kind:'action',access:'operate',surface:'desktop',desktop:'none',session:'any',goal:'받은편지함 열기',steps:['창 확인'],tools:['look']});
  return JSON.stringify({...act(f.properties.tool?.enum.includes('ask_user')?'ask_user':'reply','어느 계정을 사용할까요?'),needsInput:true});
 },execute:async a=>{calls.push(a.tool);const window={title:'받은편지함 - Gmail',process:'chrome',handle:123,pid:456};return a.tool==='windows'?{windows:[window]}:{window,elements:[]};}});
 assert.deepEqual(calls.slice(0,3),['windows','focus','look']);
 assert.equal(result.complete,false);
});
