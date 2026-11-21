import test from 'node:test';
import assert from 'node:assert/strict';
import {runAgentLoop} from '../agent-loop.mjs';
test('browser typing does not trigger a separate checklist model call',async()=>{
 let turn=0,stepReviews=0;const calls=[];
 const result=await runAgentLoop({input:'페이지 입력란에 테스트를 입력해 줘',maxSteps:5,settings:{privateBrowser:true,toolAllow:['browser_type','reply']},context:{},
 chat:async(messages,schema)=>{
  if(schema.properties.kind)return JSON.stringify({kind:'action',access:'operate',surface:'web',goal:'입력',steps:['텍스트 입력','결과 확인'],tools:['browser_type'],criteria:['입력값이 테스트'],missing:''});
  if(schema.properties.quote){stepReviews++;return JSON.stringify({quote:'테스트'});}
  if(schema.properties.checks){const e=JSON.parse(messages.at(-1).content).evidence.find(e=>e.tool==='browser_type');return JSON.stringify({checks:[{number:1,met:true,proof:[{id:e.id,line:1}],gap:''}],missing:'',stages:[]});}
  return JSON.stringify(turn++===0?{tool:'browser_type',target:'B1',text:'테스트'}:{tool:'reply',text:'테스트를 입력했습니다.'});
 },execute:async a=>{calls.push(a.tool);return '입력 확인: B1 = 테스트';}});
 assert.equal(result.complete,true,result.answer);assert.equal(stepReviews,0);assert.deepEqual(calls,['browser_type']);
});
