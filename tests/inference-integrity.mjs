import test from 'node:test';
import assert from 'node:assert/strict';
import {createConversation} from '../conversation.mjs';
import {runSimpleLoop} from '../simple-loop.mjs';

test('local structured decisions do not spend an extra generation on hidden reasoning',async()=>{
  let generations=0;
  const app=createConversation({model:'gemma4:test',settings:{noSpec:true},execute:()=>assert.fail('no action requested'),localChat:async payload=>{
    generations++;
    return Response.json(payload.think===false?{message:{content:JSON.stringify({tool:'reply',text:'안녕하세요.'})},done_reason:'stop'}:{message:{content:'',thinking:'still thinking'},done_reason:'length'});
  }});
  const result=await app.ask('안녕');assert.equal(result.answer,'안녕하세요.');assert.equal(generations,1);
});

test('truncated attachment answers are regenerated before being delivered',async()=>{
  let answers=0;
  const app=createConversation({model:'gemma4:test',attachment:'참고 자료',execute:()=>assert.fail('read-only'),
    localChat:async payload=>{
      if(payload.format?.properties?.actionQuote)return Response.json({message:{content:'{"actionQuote":""}'},done_reason:'stop'});
      answers++;
      return Response.json({message:{content:answers===1?'설명이 여기서':'설명이 끝까지 완성되었습니다.'},done_reason:answers===1?'length':'stop'});
    }});
  const result=await app.ask('첨부 자료를 설명해 주세요');
  assert.equal(result.answer,'설명이 끝까지 완성되었습니다.');
  assert.equal(answers,2);
});

test('a truncated native tool response is never dispatched and gets a bounded retry',async()=>{
  let generations=0;const writes=[];
  const app=createConversation({model:'gemma4:test',settings:{loopMode:'simple'},execute:async a=>{writes.push(a.text);return 'saved';},
    localChat:async payload=>{
      generations++;
      if(generations<=2)return Response.json({message:{tool_calls:[{id:'write-1',function:{name:'write',arguments:{path:'note.txt',content:generations===1?'partial':'complete'}}}]},done_reason:generations===1?'length':'stop'});
      return Response.json({message:{content:'파일을 저장했습니다.'},done_reason:'stop'});
    }});
  const result=await app.ask('note.txt 파일을 작성해 주세요');
  assert.deepEqual(writes,['complete']);assert.equal(result.complete,true);assert.equal(generations,3);
});

test('an output limit that persists stops without dispatching partial tools',async()=>{
  let generations=0;
  const app=createConversation({model:'gemma4:test',settings:{loopMode:'simple'},execute:()=>assert.fail('partial tool executed'),
    localChat:async()=>{generations++;return Response.json({message:{tool_calls:[{function:{name:'write',arguments:{path:'note.txt',content:'partial'}}}]},done_reason:'length'});}});
  await assert.rejects(app.ask('note.txt 파일을 작성해 주세요'),/출력|잘렸|한도/);
  assert.ok(generations<=3);
});

test('batched service discovery and file reads retain result IDs and execution order',async()=>{
  let turn=0;const actions=[];
  const result=await runSimpleLoop({input:'자료 조회',execute:async a=>{actions.push(a.tool);return a.tool==='plugin_search'?'service.read: path required':'file contents';},
    chatMessage:async({messages})=>{
      if(turn++===0)return {tool_calls:[{id:'discover-1',function:{name:'service_search',arguments:{query:'service read'}}},{id:'read-1',function:{name:'read',arguments:{path:'note.txt'}}}]};
      const receipts=messages.filter(m=>m.role==='tool');
      assert.deepEqual(receipts.map(m=>m.tool_call_id),['discover-1','read-1']);
      assert.match(receipts[0].content,/service.read/);assert.equal(receipts[1].content,'file contents');
      return {content:'자료를 확인했습니다.'};
    }});
  assert.deepEqual(actions,['plugin_search','read']);assert.equal(result.complete,true);
});
