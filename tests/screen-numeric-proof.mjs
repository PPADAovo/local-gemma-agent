import test from 'node:test';
import assert from 'node:assert/strict';
import * as agent from '../agent-loop.mjs';

const text='화면을 확인하고 저장했습니다. LOCAL-ONLY-20261119';
const report=`요청하신 작업을 완료했습니다.\n\n1. **입력 내용 확인**: "${text}"가 정확히 입력되었습니다.\n2. **저장 완료 확인**: "상태: 저장 완료 · 36자"를 확인했습니다.`;

test('screen numeric claims ignore report ordinals and identifiers but include attached units',()=>{
  assert.equal(typeof agent.extractScreenNumbers,'function');
  assert.deepEqual(agent.extractScreenNumbers(report),['36']);
  assert.deepEqual(agent.extractScreenNumbers('E1 LOCAL-ONLY-20261119\n상태: 저장 완료 · 36자'),['36']);
  assert.deepEqual(agent.extractScreenNumbers('1. 첫 항목\n**2.** 다음 항목\n(3) 마지막 항목'),[]);
  assert.deepEqual(agent.extractScreenNumbers('표시는 −1,234.50\n결과는 +0036.00자'),['-1234.5','36']);
});

async function desktopReply(answer,observed){
  let clicked=false,rejected=false;
  const frame={image:'fixture',cleanImage:'fixture',imageWidth:600,imageHeight:400,left:0,top:0,width:600,height:400,window:{handle:10,pid:20,process:'fixture',title:'테스트 편집기',rect:[0,0,600,400]},elements:[{id:1,name:'파일 저장',type:'Button',x:300,y:300}]};
  const result=await agent.runAgentLoop({input:'저장 버튼을 클릭하고 화면 내용을 확인해 줘',settings:{noSpec:true,computerUse:true,manualHandoff:false,toolAllow:['look','click']},context:{selectedWindow:true},maxSteps:8,
    chat:async(messages,format)=>{
      if(messages.some(m=>/답변의 숫자가 마지막 화면/.test(String(m.content))))rejected=true;
      if(format?.properties?.located)return JSON.stringify({located:true,selectedMatches:true,elementId:1,x:500,y:750,label:'파일 저장',evidence:'현재 버튼'});
      if(format?.properties?.verified)return JSON.stringify({verified:true,quote:observed,gap:''});
      if(format?.properties?.checks)return JSON.stringify({checks:[],missing:''});
      return JSON.stringify(clicked?{tool:'reply',text:answer,thought:'화면을 확인했습니다.'}:{tool:'click',text:'E1',thought:'파일 저장 버튼을 클릭합니다.'});
    },execute:async action=>{
      if(action.tool==='look')return {...frame,texts:[clicked?observed:'상태: 저장 전']};
      if(action.tool==='click'){clicked=true;return {ok:true};}
      throw Error('Unexpected fixture tool '+action.tool);
    }});
  return {result,rejected};
}

test('saved desktop reply with ID, numbered list and 36자 passes without false numeric repair',async()=>{
  const {result,rejected}=await desktopReply(report,text+'\n상태: 저장 완료 · 36자');
  assert.equal(rejected,false);
  assert.equal(result.complete,true);
});

test('fabricated and wrong-sign calculator-like results remain blocked by numeric proof',async()=>{
  for(const answer of ['계산 결과는 999입니다.','계산 결과는 -36입니다.']){
    const {result,rejected}=await desktopReply(answer,'계산 결과: 36');
    assert.equal(rejected,true,answer);
    assert.equal(result.complete,false,answer);
  }
});
