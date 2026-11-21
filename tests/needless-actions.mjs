import test from 'node:test';
import assert from 'node:assert/strict';
import {runAgentLoop} from '../agent-loop.mjs';

const specFor=(extra)=>JSON.stringify({kind:'action',access:'operate',continuity:'new_topic',surface:'other',session:'any',desktop:'none',goal:'작업',
  skillPlan:[],workflow:'general',externalCapability:'',steps:['하기'],tools:[],criteria:['한다'],missing:'',...extra});
const run=async(input,spec)=>{
  const executed=[];let turn=0;
  const steps=[{tool:'list',text:'',path:'.',thought:'목록'},{tool:'reply',text:'a.txt가 있습니다.',path:'',thought:'끝'}];
  await runAgentLoop({input,settings:{toolAllow:['find_free_tool','generate_image','list','reply']},context:{},maxSteps:8,
    chat:async(m,f)=>{
      if(f?.properties?.kind)return spec;
      if(f?.properties?.verified||f?.properties?.checks)return JSON.stringify({verified:true,quote:'a.txt',gap:'',checks:[],missing:''});
      return JSON.stringify(steps[Math.min(turn++,steps.length-1)]);},
    execute:async a=>{executed.push(a.tool);return a.tool==='list'?'a.txt':a.tool==='find_free_tool'?{capability:'image-generation',candidates:[]}:'ok';}});
  return executed;
};

test('an image generator attached to an unrelated request by the plan is not looked up',async()=>{
  const executed=await run('만든 파일을 바탕화면 새 폴더로 옮겨줘',specFor({externalCapability:'image-generation'}));
  assert.ok(!executed.includes('find_free_tool'),executed.join(','));
});

test('an image request still looks up the free image tool first',async()=>{
  const executed=await run('고양이 그림 그려줘',specFor({externalCapability:'image-generation'}));
  assert.equal(executed[0],'find_free_tool');
});

test('a screen recording request mislabeled as photo editing keeps all its tools',async()=>{
  let offered=null;
  const {runAgentLoop}=await import('../agent-loop.mjs');
  await runAgentLoop({input:'내 화면 5초 녹화후에 이메일로 보내줘 나한테',settings:{computerUse:true,webMode:'always',webEnabled:true},context:{askUser:async()=>'작업 중지'},maxSteps:1,
    chat:async(m,f)=>{
      if(f?.properties?.kind)return JSON.stringify({kind:'action',access:'operate',continuity:'new_topic',surface:'desktop',session:'any',desktop:'inspect',goal:'녹화 후 메일',skillPlan:[],workflow:'photo-background',externalCapability:'',steps:['녹화','메일 발송'],tools:['plugin_search','plugin_call'],criteria:['보낸다'],missing:''});
      if(f?.properties?.tool?.enum&&!offered)offered=f.properties.tool.enum;
      return JSON.stringify({tool:'reply',text:'x',path:'',thought:''});},
    execute:async a=>a.tool==='windows'?{foreground:{},windows:[]}:a.tool==='plugin_search'?[]:'ok'}).catch(()=>{});
  assert.ok(offered?.includes('record_screen'),String(offered));
});
