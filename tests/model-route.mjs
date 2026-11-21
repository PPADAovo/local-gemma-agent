import test from 'node:test';
import assert from 'node:assert/strict';
import {needsAgentModel,pickAgentModel} from '../model-route.mjs';
import {runAgentLoop} from '../agent-loop.mjs';

test('desktop and service actions need the larger model, chat does not',()=>{
  assert.equal(needsAgentModel({kind:'chat',tools:[]}),false);
  assert.equal(needsAgentModel({kind:'action',desktop:'interact',tools:[]}),true);
  assert.equal(needsAgentModel({kind:'action',desktop:'none',tools:['plugin_call'],steps:['보내기']}),true);
  assert.equal(needsAgentModel({kind:'action',desktop:'none',tools:['read'],steps:['읽기']}),false);
  assert.equal(needsAgentModel(null),false);
});

test('service lookup requests need tool-capable routing even when classified as chat',()=>{
  assert.equal(needsAgentModel({kind:'chat',access:'observe',tools:['plugin_call'],steps:['일정 조회']}),true);
});

test('the larger model is picked only when installed and fitting',()=>{
  const installed=new Set(['gemma4:12b','qwen3.5:35b','gemma4:26b']);
  const isInstalled=name=>installed.has(name);
  assert.equal(pickAgentModel({current:'gemma4:12b',isInstalled,fits:()=>true}),'qwen3.5:35b');
  assert.equal(pickAgentModel({current:'gemma4:12b',isInstalled,fits:name=>name!=='qwen3.5:35b'?true:false}),'gemma4:26b');
  assert.equal(pickAgentModel({current:'gemma4:12b',isInstalled:name=>name==='gemma4:12b',fits:()=>true}),null);
  assert.equal(pickAgentModel({current:'qwen3.5:35b',isInstalled,fits:()=>true}),null);
});

test('the loop asks to switch models for an interactive task spec',async()=>{
  const seen=[];
  await runAgentLoop({input:'카카오톡으로 메시지 보내줘',settings:{computerUse:true},maxSteps:1,
    context:{chooseModelForSpec:async spec=>seen.push(spec.desktop)},
    chat:async(m,f)=>f?.properties?.goal?JSON.stringify({kind:'action',goal:'메시지 보내기',desktop:'interact',surface:'desktop',steps:['열기','보내기'],tools:['click'],criteria:['보냄']}):JSON.stringify({tool:'reply',text:'끝',path:''}),
    execute:async()=>''});
  assert.deepEqual(seen,['interact']);
});
