import test from 'node:test';
import assert from 'node:assert/strict';
import {runAgentLoop} from '../agent-loop.mjs';

const skills=['a-guide','b-guide','c-guide','d-guide'].map(name=>({name,description:name+' 설명'}));
const run=async brain=>{
  const loaded=[];let notes='';let turn=0;
  await runAgentLoop({input:'웹페이지 만들어줘',settings:{brain,toolAllow:['skill','reply'],skills},context:{},maxSteps:10,
    chat:async(m,f)=>{
      if(f?.properties?.kind)return JSON.stringify({kind:'action',access:'operate',continuity:'new_topic',surface:'other',session:'any',desktop:'none',goal:'웹페이지',
        skillPlan:skills.map(s=>({name:s.name,use:s.name+' 단계'})),workflow:'general',externalCapability:'',steps:['만들기'],tools:['skill'],criteria:['만든다'],missing:''});
      if(f?.properties?.verified||f?.properties?.checks)return JSON.stringify({verified:true,quote:'',gap:'',checks:[],missing:''});
      notes=m.filter(x=>x.role==='system').map(x=>x.content).join('\n');
      turn++;return JSON.stringify({tool:'reply',text:'완료했습니다.',path:'',thought:'끝'});},
    execute:async a=>{if(a.tool==='skill')loaded.push(a.text);return '설명서 '+a.text;}});
  return {loaded,notes};
};

test('the local model preloads at most two guides and is told the others by name',async()=>{
  const {loaded,notes}=await run('local');
  assert.deepEqual(loaded,['a-guide','b-guide']);
  assert.match(notes,/c-guide \(c-guide 단계\), d-guide/);
});

test('a cloud judgment model preloads up to three guides',async()=>{
  const {loaded}=await run('mix');
  assert.deepEqual(loaded,['a-guide','b-guide','c-guide']);
});
