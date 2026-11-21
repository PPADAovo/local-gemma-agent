import test from 'node:test';
import assert from 'node:assert/strict';
import {extractAppPassword,redactPasswords} from '../secrets.mjs';
import {runAgentLoop} from '../agent-loop.mjs';

const look={image:'aGVsbG8=',imageWidth:1,imageHeight:1,elements:[],texts:['잠금 해제','비밀번호'],window:{title:'카카오톡',handle:1,pid:2,process:'KakaoTalk'}};

test('a given app password is found and hidden from the model',()=>{
  const hit=extractAppPassword('카카오톡 열어서 캡쳐한 사진 나한테 보내줘 카톡 비번 1818이야');
  assert.equal(hit.app,'kakaotalk');assert.equal(hit.secret,'1818');
  assert.doesNotMatch(hit.redacted,/1818/);
  assert.equal(extractAppPassword('카톡 비번 바꿔줘'),null);
  assert.doesNotMatch(redactPasswords('카톡 비번 1818이야 그리고 카톡 비밀번호는 abc12! 이야'),/1818|abc12/);
});

const lockRun=async({hasSecret})=>{
  const calls=[],cards=[];let turn=0,manuallyUnlocked=false;
  const steps=[{tool:'look',text:'',path:'',thought:'화면 확인'},
    {tool:'reply',text:'카카오톡 잠금 화면이 보입니다. 비밀번호를 입력해 주세요.',path:'',thought:'잠금',needsInput:true},
    {tool:'unlock_app',text:'kakaotalk',path:'',thought:'저장된 비밀번호로 해제'},
    {tool:'reply',text:'잠금을 풀었습니다.',path:'',thought:'끝'}];
  // 저장된 비밀번호가 있으면 앱이 화면을 보자마자 잠금을 풀기 때문에, 모델은 잠금에 대해 묻지 않고 바로 마무리합니다.
  steps.splice(1,2);
  await runAgentLoop({input:'카카오톡 열어줘',settings:{noSpec:true,toolAllow:['look','unlock_app','reply']},maxSteps:10,
    context:{selectedWindow:{handle:1,pid:2,title:'카카오톡'},hasSecret:async()=>hasSecret,askUser:async c=>{cards.push(c);manuallyUnlocked=true;return '완료했어요';}},
    chat:async(m,f)=>f?.properties?.verified?JSON.stringify({verified:true,quote:'',gap:''}):f?.properties?.decision?JSON.stringify({decision:'ask',reason:''}):JSON.stringify(steps[Math.min(turn++,steps.length-1)]),
    execute:async a=>{calls.push(a.tool);return a.tool==='look'?(manuallyUnlocked||calls.includes('unlock_app')?{...look,texts:['채팅']}:look):'카카오톡 창에 저장된 잠금 비밀번호를 입력했습니다.';}});
  return {calls,cards};
};

test('with a saved password the lock is opened by unlock_app without asking the user',async()=>{
  const {calls,cards}=await lockRun({hasSecret:true});
  assert.ok(calls.includes('unlock_app'),calls.join(','));
  assert.equal(cards.length,0);
});

test('without a saved password the user gets a do-it-yourself card, not a password question',async()=>{
  const {cards}=await lockRun({hasSecret:false});
  assert.equal(cards.length,1);
  assert.equal(cards[0].title,'직접 해 주세요');
  assert.match(cards[0].question,/비밀번호는 채팅에 쓰지 마세요/);
  assert.deepEqual(cards[0].options,['완료했어요','작업 중지']);
});

test('re-reading the screen guide to check the screen becomes a real screen check, and is bounded',async()=>{
  const calls=[];
  const result=await runAgentLoop({input:'카카오톡 창 확인해줘',settings:{noSpec:true,toolAllow:['skill','look'],skills:[{name:'computer-use:computer-use',description:'화면'}]},maxSteps:30,
    context:{selectedWindow:{handle:1,pid:2,title:'카카오톡'}},
    chat:async(m,f)=>f?.properties?.verified?JSON.stringify({verified:false,quote:'',gap:''}):JSON.stringify({tool:'skill',text:'computer-use:computer-use',path:'',thought:'잠금 해제 후 카카오톡 창 상태 확인'}),
    execute:async a=>{calls.push(a.tool);return a.tool==='look'?look:'설명서';}});
  assert.ok(calls.includes('look'),calls.join(','));
  assert.ok(calls.length<15,'calls='+calls.length);
  assert.equal(result.complete,false);
});
