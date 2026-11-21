import test from 'node:test';
import assert from 'node:assert/strict';
import {runAgentLoop} from '../agent-loop.mjs';

const window={title:'카카오톡',process:'KakaoTalk',handle:1,pid:2,rect:[0,0,100,100]};
const screen=locked=>({window,image:locked?'bG9jaw==':'b3Blbg==',imageWidth:100,imageHeight:100,texts:[],elements:[{id:7,name:locked?'장금모드상대입니다':'채팅',type:'OcrText',x:50,y:50}]});
async function scenario({answers=['완료했어요'],unlockTool=true,secretManual=false,alwaysLocked=false}={}){
  const sequence=[];let asks=0,looks=0;
  const result=await runAgentLoop({input:'카카오톡 잠금을 풀고 채팅 화면을 확인해줘',maxSteps:12,
    settings:{noSpec:true,toolAllow:['look','reply','user_action',...(unlockTool?['unlock_app']:[])]},
    context:{selectedWindow:window,hasSecret:async()=>false,
      ...(secretManual?{askSecret:async()=>{asks++;sequence.push('manual');return 'manual';}}:{}),
      askUser:async card=>{sequence.push('ask');assert.match(card.question,/잠금/);return answers[asks++]||'작업 중지';}},
    chat:async(m,f)=>f?.properties?.verified?JSON.stringify({verified:true,quote:'채팅',gap:''}):JSON.stringify({tool:'reply',text:'채팅 화면을 확인했습니다.',path:'',thought:'완료'}),
    execute:async a=>{sequence.push(a.tool);assert.equal(a.tool,'look');return screen(++looks<=answers.length || alwaysLocked);}});
  return {result,sequence,asks,looks};
}
test('a detected lock falls back to a user request and verifies the screen afterwards',async()=>{
  const r=await scenario();assert.deepEqual(r.sequence,['look','ask','look']);assert.equal(r.result.complete,true);
});
test('manual handoff works when the unlock tool is unavailable',async()=>{
  const r=await scenario({unlockTool:false});assert.deepEqual(r.sequence,['look','ask','look']);assert.equal(r.result.complete,true);
});
test('a completed handoff with a still locked screen requests help again instead of claiming success',async()=>{
  const r=await scenario({answers:['완료했어요','작업 중지']});assert.deepEqual(r.sequence,['look','ask','look','ask']);assert.equal(r.result.complete,false);
});
test('cancelling a handoff does not resume desktop actions',async()=>{
  const r=await scenario({answers:['작업 중지']});assert.deepEqual(r.sequence,['look','ask']);assert.equal(r.result.complete,false);
});
test('manual completion from the secret dialog permits a fresh screen check',async()=>{
  const r=await scenario({secretManual:true});assert.deepEqual(r.sequence,['look','manual','look']);assert.equal(r.result.complete,true);
});
test('persistent lock is reported as needing input after two completed handoffs',async()=>{
  const r=await scenario({answers:['완료했어요','완료했어요'],alwaysLocked:true});
  assert.deepEqual(r.sequence,['look','ask','look','ask','look']);
  assert.equal(r.result.complete,false);assert.equal(r.result.needsInput,true);
  assert.match(r.result.answer,/잠금/);
});
