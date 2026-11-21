import assert from 'node:assert/strict';
import test from 'node:test';
import {effectivePermission} from '../permission-mode.mjs';
import {runAgentLoop} from '../agent-loop.mjs';
test('valid request mode takes priority while saved and legacy preferences remain supported',()=>{
 for(const [request,settings,want] of [
  ['confirm',{approval:'full'},'confirm'],['full',{approval:'auto'},'full'],
  [undefined,{approval:'confirm'},'confirm'],['unknown',{approval:'auto',fullAccess:true},'auto'],
  [undefined,{fullAccess:true},'full'],[undefined,{},'auto']])
  assert.equal(effectivePermission(request,settings),want);
});
const spec={kind:'action',access:'operate',surface:'file',desktop:'none',session:'any',goal:'계산',steps:['첫 계산','다음 계산'],tools:['calc'],criteria:[],done_when:'계산 완료',missing:''};
test('confirm mode calls a tool without inventing a separate whole-plan approval',async()=>{
 const calls=[];
 await runAgentLoop({input:'두 계산 실행해줘',settings:{approval:'confirm',toolAllow:['calc']},context:{askUser:async()=>assert.fail('implicit plan approval')},maxSteps:1,
  chat:async(_m,f)=>JSON.stringify(f.properties.kind?spec:{tool:'calc',path:'',text:'1+1',thought:'계산'}),
  execute:async a=>{calls.push(a.tool);return '2';}});
 assert.ok(calls.length>0); assert.ok(calls.every(tool=>tool==='calc'));
});
test('explicit plan approval still stops execution when declined in full mode',async()=>{
 let asked=0;
 const result=await runAgentLoop({input:'계획 승인 받고 실행해줘',settings:{approval:'full',toolAllow:['calc']},context:{askUser:async card=>{asked++;assert.equal(card.title,'작업 계획 승인');return '작업 중지';}},
  chat:async()=>JSON.stringify(spec),execute:async()=>assert.fail('declined plan executed')});
 assert.equal(asked,1);
 assert.equal(result.complete,false);
});

