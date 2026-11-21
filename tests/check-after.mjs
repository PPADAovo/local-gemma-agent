import test from 'node:test';
import assert from 'node:assert/strict';
import {runAgentLoop} from '../agent-loop.mjs';

test('an action that carries checkAfter marks its step done without another model call',async()=>{
  let modelCalls=0;const executed=[],logs=[];let turn=0;
  const steps=[
    {tool:'plan',text:'1. 목록 확인\n2. 파일 읽기',path:'',thought:'계획'},
    {tool:'list',text:'',path:'.',thought:'목록',checkAfter:1},
    {tool:'read',text:'0',path:'a.txt',thought:'읽기',checkAfter:2},
    {tool:'reply',text:'a.txt 내용은 안녕입니다.',path:'',thought:'끝'}];
  const result=await runAgentLoop({input:'폴더 목록을 보고 a.txt를 읽어줘',settings:{noSpec:true,toolAllow:['plan','check','list','read','reply']},context:{},maxSteps:12,log:line=>logs.push(String(line)),
    chat:async(m,f)=>{
      if(f?.properties?.verified||f?.properties?.checks||f?.properties?.met||f?.properties?.supported)return JSON.stringify({verified:true,quote:'안녕',gap:'',checks:[],missing:'',met:true,supported:true});
      modelCalls++;return JSON.stringify(steps[Math.min(turn++,steps.length-1)]);},
    execute:async a=>{executed.push(a.tool);return a.tool==='list'?'a.txt':a.tool==='read'?'안녕':'ok';}});
  assert.ok(executed.includes('list')&&executed.includes('read'),executed.join(','));
  // 모델은 plan, list, read, reply 네 번만 불립니다(check를 위한 호출 없음).
  assert.equal(modelCalls,4,'model calls='+modelCalls+' answer='+result.answer);
  assert.equal(result.complete,true,result.answer);
  // 단계 확인은 각 동작 바로 뒤에, 모델 호출 없이 이루어집니다.
  const order=logs.filter(l=>/^(성공|실패) (list|read|check)/.test(l)).map(l=>l.split(':')[0]);
  assert.deepEqual(order,['성공 list','성공 check','성공 read','성공 check'],logs.join(String.fromCharCode(10)));
});
