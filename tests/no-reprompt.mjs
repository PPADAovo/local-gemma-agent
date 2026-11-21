import test from 'node:test';
import assert from 'node:assert/strict';
import {runAgentLoop} from '../agent-loop.mjs';
import {runSimpleLoop} from '../simple-loop.mjs';
const bad='도구가 루프에 빠졌습니다. "파일 목록을 확인해"라고 명확하게 한 번 더 지시해 주세요.\nQ1. 다른 형식이 필요한가요?';
test('regular loop rejects reissuing the same request and resumes a read',async()=>{
 let n=0;const calls=[],cards=[];
 const result=await runAgentLoop({input:'현재 폴더 파일 목록 확인해줘',settings:{noSpec:true,computerUse:false,toolAllow:['list','reply']},context:{askUser:async c=>{cards.push(c);return '작업 중지';}},
 chat:async(m,f)=>JSON.stringify(f?.properties?.verified?{verified:true,quote:'memo.txt',gap:''}:[{tool:'reply',text:bad,needsInput:true},{tool:'list',path:''},{tool:'reply',text:'memo.txt가 있습니다.'}][Math.min(n++,2)]),
 execute:async a=>{calls.push(a.tool);return 'memo.txt';}});
 assert.deepEqual(calls,['list']);assert.equal(cards.length,0);assert.equal(result.complete,true);
});
test('simple loop rejects reissuing instructions even without a question ending',async()=>{
 let n=0;const calls=[];
 const r=await runSimpleLoop({input:'파일 목록 확인해줘',chatMessage:async()=>n++===0?{content:bad}:n===2?{tool_calls:[{function:{name:'list',arguments:{path:''}}}]}:{content:'memo.txt가 있습니다.'},execute:async a=>{calls.push(a.tool);return 'memo.txt';}});
 assert.deepEqual(calls,['list']);assert.equal(r.complete,true);
});
test('repeated deflection ends as incomplete without showing the instruction to the user',async()=>{
 const r=await runSimpleLoop({input:'파일 목록 확인해줘',chatMessage:async()=>({content:bad}),execute:async()=>assert.fail('no tool requested')});
 assert.equal(r.complete,false);assert.equal(r.needsInput,false);assert.doesNotMatch(r.answer,/다시.*지시|한 번 더/);
});
test('real user-only action is still allowed',async()=>{
 const cards=[];let n=0;
 await runSimpleLoop({input:'화면 확인해줘',context:{askUser:async c=>{cards.push(c);return '작업 중지';}},chatMessage:async()=>({tool_calls:[{function:{name:'user_action',arguments:{request:'카카오톡에서 직접 잠금을 풀어 주세요.'}}}]}),execute:async()=>assert.fail('cancelled')});
 assert.equal(cards.length,1);
});
