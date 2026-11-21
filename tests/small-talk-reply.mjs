import test from 'node:test';
import assert from 'node:assert/strict';
import {runAgentLoop,isSmallTalk} from '../agent-loop.mjs';

// 2026-11-20: "안녕" got "안녕하세요! 무엇을 도와드릴까요?" back, but because short small talk has no task spec,
// the reply was treated as a question and turned into a '추가 정보가 필요합니다' card (only option: 작업 중지).
for(const input of ['안녕','고마워','ㅎㅇ'])test(`small talk "${input}" is answered directly without a question card`,async()=>{
 const cards=[];let calls=0;
 const result=await runAgentLoop({input,settings:{toolAllow:['reply']},maxSteps:4,
  context:{askUser:async card=>{cards.push(card);return '작업 중지';}},
  chat:async(messages,schema)=>{calls++;
   if(schema?.properties?.verified)return JSON.stringify({verified:true,quote:'',gap:''});
   return JSON.stringify({tool:'reply',text:'안녕하세요! 무엇을 도와드릴까요?',path:'',needsInput:false,thought:'인사'});
  },execute:async()=>{throw Error('no tools expected');}});
 assert.equal(cards.length,0,'no question card for a greeting');
 assert.equal(result.answer,'안녕하세요! 무엇을 도와드릴까요?');
 assert.equal(result.complete,true);
 assert.equal(calls,1,'the greeting reply is not re-reviewed by another model call');
});

test('small talk detection stays narrow',()=>{
 for(const t of ['안녕','안녕!','ㅋㅋ','ok','고마워~'])assert.equal(isSmallTalk(t),true,t);
 for(const t of ['열어봐','저장','안녕 카톡 열어줘','파일 정리해줘','고마워 그럼 저장해'])assert.equal(isSmallTalk(t),false,t);
});
