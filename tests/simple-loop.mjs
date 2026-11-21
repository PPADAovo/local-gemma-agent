import test from 'node:test';
import assert from 'node:assert/strict';
import {runSimpleLoop,toAction,missingArgs,SIMPLE_TOOLS} from '../simple-loop.mjs';

const frame={image:'aGVsbG8=',imageWidth:100,imageHeight:100,left:1000,top:500,width:200,height:200,elements:[{id:7,name:'보내기',x:1150,y:650,type:'button'}],window:{title:'카카오톡',handle:1,pid:2}};
const call=(name,args)=>({tool_calls:[{function:{name,arguments:args}}]});

test('every tool has its own input schema and maps to the executor format',()=>{
  assert.ok(SIMPLE_TOOLS.length>=15);
  assert.deepEqual(toAction('key',{keys:'ctrl+f'}),{thought:'단순 실행',tool:'key',text:'ctrl+f'});
  assert.deepEqual(toAction('service_call',{name:'gmail.send_email',args:{to:'me'}}),{thought:'단순 실행',tool:'plugin_call',path:'gmail.send_email',text:'{"to":"me"}'});
  assert.deepEqual(missingArgs('click',{}),['target']);
});

test('the model drives look → click → answer and the loop ends when it stops calling tools',async()=>{
  const executed=[];let turn=0;
  const script=[call('look',{}),call('click',{target:'E7'}),call('click',{target:'50,50'}),{content:'보내기 버튼을 눌렀습니다.'}];
  const result=await runSimpleLoop({input:'보내기 눌러줘',
    chatMessage:async()=>script[turn++],
    execute:async action=>{executed.push(action);return action.tool==='look'?frame:{ok:true};}});
  assert.equal(result.complete,true);
  assert.equal(result.answer,'보내기 버튼을 눌렀습니다.');
  assert.deepEqual(executed.map(a=>a.tool),['look','click','look','click','look']);
  assert.equal(executed[1].absX,1150);
  assert.deepEqual([executed[3].absX,executed[3].absY],[1100,600]);
});

test('missing arguments and repeated side effects are refused without running',async()=>{
  const executed=[];let turn=0;const seen=[];
  const script=[call('type',{}),call('run',{command:'echo hi'}),call('run',{command:'echo hi'}),{content:'끝났습니다.'}];
  await runSimpleLoop({input:'테스트',
    chatMessage:async({messages})=>{seen.push(messages.at(-1));return script[turn++];},
    execute:async action=>{executed.push(action.tool);return 'ok';}});
  assert.deepEqual(executed,['run']);
  assert.match(seen[1].content,/입력이 빠졌습니다/);
  assert.match(seen[3].content,/이미 실행했습니다/);
});

test('user_action waits for the user, and a question ends as needing input',async()=>{
  let turn=0;const cards=[];
  const script=[call('user_action',{request:'카카오톡 잠금을 풀어 주세요'}),{content:'누구에게 보낼까요?'}];
  const result=await runSimpleLoop({input:'카톡 보내줘',context:{askUser:async card=>{cards.push(card);return '완료했어요';}},
    chatMessage:async()=>script[turn++],execute:async()=>'ok'});
  assert.equal(cards.length,1);
  assert.equal(result.needsInput,true);
  assert.equal(result.complete,false);
});

test('the same call with the same result is warned, then blocked, then the run ends',async()=>{
  const executed=[];
  const result=await runSimpleLoop({input:'검색창 열어줘',maxSteps:20,
    chatMessage:async()=>call('look',{}),
    execute:async action=>{executed.push(action.tool);return frame;}});
  assert.equal(executed.length,2,'실행 '+executed.length+'번');
  assert.equal(result.complete,false);
  assert.match(result.answer,/반복돼서 멈췄습니다/);
});

test('new capture filenames do not disguise repeated observations',async()=>{
  let executions=0;
  const result=await runSimpleLoop({input:'검색창 확인',maxSteps:12,
    chatMessage:async()=>call('look',{}),
    execute:async()=>({...frame,capturePath:'screen-'+(++executions)+'.jpg'})});
  assert.equal(executions,2);
  assert.equal(result.complete,false);
});

test('renumbered elements cannot bypass the unchanged-screen click guard',async()=>{
  let turn=0,looks=0,clicks=0;
  const result=await runSimpleLoop({input:'버튼 눌러 줘',maxSteps:16,
    chatMessage:async()=>turn++%2===0?call('look',{}):call('click',{target:'E'+looks}),
    execute:async a=>{if(a.tool==='look')return {...frame,elements:[{...frame.elements[0],id:++looks}],capturePath:looks+'.jpg'};clicks++;return {ok:true,attempt:clicks};}});
  assert.ok(clicks<=2,'unchanged clicks='+clicks);
  assert.equal(result.complete,false);
  assert.match(result.answer,/반복/);
});

test('the same navigation click remains allowed when the observed page changes',async()=>{
  let turn=0,looks=0,clicks=0;
  const result=await runSimpleLoop({input:'다음 페이지 네 번 열어 줘',maxSteps:12,
    chatMessage:async()=>turn++>=8?{content:'네 페이지 확인했습니다.'}:turn%2?call('look',{}):call('click',{target:'E7'}),
    execute:async a=>{if(a.tool==='look')return {...frame,texts:['페이지 '+(++looks)]};clicks++;return {ok:true};}});
  assert.equal(clicks,4);
  assert.equal(result.complete,true);
});
