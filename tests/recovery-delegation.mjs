import test from 'node:test';
import assert from 'node:assert/strict';
import {runAgentLoop} from '../agent-loop.mjs';

// 2026-11-16: 막힌 로컬 작업을 Gemini에 넘기던 기능은 사용자 요청으로 없앴습니다. 로컬 모델이 스스로 다른 방법을 고릅니다.
test('failed local work is recovered by the local model itself, never handed to another model',async()=>{
  const executed=[];let recoveryAsked=0;
  const result=await runAgentLoop({input:'report.txt 내용을 확인해 줘',settings:{noSpec:true,toolAllow:['read','reply']},maxSteps:6,
    context:{recoveryChat:async()=>assert.fail('다른 모델에게 넘기면 안 됨')},
    chat:async(messages,schema)=>{
      if(schema?.properties?.verified)return JSON.stringify({verified:true,quote:'보고서 본문',gap:''});
      // 실패 후 다음 경로를 고르는 질문도 로컬 chat이 받습니다.
      if(schema?.properties?.tool?.enum && !schema.properties.thought){recoveryAsked++;return JSON.stringify({tool:'read',path:'report.txt',text:'',reason:'정확한 파일 이름으로 다시 읽기'});}
      return JSON.stringify(executed.includes('report.txt')?{tool:'reply',text:'보고서 본문입니다.',path:'',thought:'끝'}:{tool:'read',path:executed.length?'report.txt':'wrong.txt',text:'',thought:'읽기'});
    },
    execute:async a=>{executed.push(a.path);if(a.path==='wrong.txt')throw Error('not found');return '보고서 본문';}});
  assert.ok(executed.includes('report.txt'),executed.join(','));
  assert.equal(result.complete,true,result.answer);
});
