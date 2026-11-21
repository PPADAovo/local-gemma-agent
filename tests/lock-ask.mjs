import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {runAgentLoop} from '../agent-loop.mjs';
import {askAppSecret,secretFromAnswer} from '../secret-ask.mjs';

const win={title:'카카오톡',handle:1,pid:2,process:'KakaoTalk',rect:[0,0,100,100]};
// 화면 글자 인식 결과 그대로("잠"을 "장"으로 읽은 경우 포함)
const locked={image:'bG9jaw==',imageWidth:100,imageHeight:100,texts:[],window:win,elements:[
  {id:6,name:'장금모드상대입니다',type:'OcrText',x:50,y:40},{id:7,name:'Windows HeIIo로잠금해제',type:'OcrText',x:50,y:60}]};
const open={image:'b3Blbg==',left:0,top:0,width:100,height:100,imageWidth:100,imageHeight:100,texts:[],window:win,elements:[{id:5,name:'채팅',type:'OcrText',x:20,y:20}]};

const run=async({hasSecret,askSecret,steps,initialScreen=locked})=>{
  const calls=[],asked=[];let turn=0,unlocked=false;
  const result=await runAgentLoop({input:'카카오톡 열어서 화면 확인해줘',settings:{noSpec:true,toolAllow:['look','click','unlock_app','reply']},maxSteps:12,
    context:{selectedWindow:{handle:1,pid:2,title:'카카오톡'},hasSecret:async()=>hasSecret,forgetSecret:async()=>{},
      askSecret:askSecret&&(async(app,retry)=>{asked.push([app,retry]);return askSecret;}),askUser:async()=>'완료했어요'},
    chat:async(m,f)=>f?.properties?.located?JSON.stringify({located:true,selectedMatches:true,x:50,y:60,label:'채팅'}):f?.properties?.verified?JSON.stringify({verified:true,quote:'',gap:''}):JSON.stringify(steps[Math.min(turn++,steps.length-1)]),
    execute:async a=>{calls.push(a.tool+(a.tool==='click'?':'+a.elementName:''));if(a.tool==='unlock_app'){unlocked=true;return '카카오톡 창에 저장된 잠금 비밀번호를 입력했습니다.';}
      return a.tool==='look'?(unlocked?open:initialScreen):{ok:true,window:win};}});
  return {calls,asked,result};
};
const reply={tool:'reply',text:'화면을 확인했습니다.',path:'',thought:'끝'};

test('a lock screen seen on screen asks for the password, then unlocks without the model handling it',async()=>{
  const {calls,asked}=await run({hasSecret:false,askSecret:'saved',steps:[reply]});
  assert.deepEqual(asked,[['kakaotalk',false]]);
  assert.ok(calls.includes('unlock_app'),calls.join(','));
});

test('a lock screen with a saved password is unlocked without asking',async()=>{
  const {calls,asked}=await run({hasSecret:true,askSecret:'saved',steps:[reply]});
  assert.equal(asked.length,0);
  assert.ok(calls.includes('unlock_app'),calls.join(','));
});

test('a bare number picks the numbered item drawn on the screenshot',async()=>{
  const initialScreen={...open,elements:[{id:7,name:'채팅',type:'OcrText',x:50,y:60}]};
  const {calls}=await run({hasSecret:false,askSecret:null,initialScreen,steps:[{tool:'click',text:'7',path:'',thought:'번호 클릭'},reply]});
  assert.ok(calls.includes('click:채팅'),calls.join(','));
});

test('the password answer is saved, masked in the inbox, and sentences are not taken as passwords',async()=>{
  assert.equal(secretFromAnswer('비번 ab12!'),'ab12!');
  assert.equal(secretFromAnswer('4821이야'),'4821');
  assert.equal(secretFromAnswer('내가 풀었어'),'');
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'lock-ask-'));
  const inbox=path.join(dir,'inbox.jsonl');
  await fs.writeFile(inbox,JSON.stringify({askId:'x',answer:'4821'})+'\n');
  const saved=[];
  const outcome=await askAppSecret('kakaotalk',false,{ask:async()=>'4821',save:async(app,v)=>saved.push([app,v]),inbox});
  assert.equal(outcome,'saved');
  assert.deepEqual(saved,[['kakaotalk','4821']]);
  assert.doesNotMatch(await fs.readFile(inbox,'utf8'),/4821/);
  assert.equal(await askAppSecret('kakaotalk',false,{ask:async()=>'직접 풀었어요',save:async()=>assert.fail('저장 안 함'),inbox}),'manual');
  assert.equal(await askAppSecret('kakaotalk',false,{ask:async()=>'작업 중지',save:async()=>assert.fail('저장 안 함'),inbox}),'stop');
  await fs.rm(dir,{recursive:true,force:true});
});
