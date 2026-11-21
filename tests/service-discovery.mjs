import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {localManager} from '../local-service-plugins.mjs';
import {runAgentLoop} from '../agent-loop.mjs';

test('a specific service mention does not discover other services through a shared substring',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gemma-service-route-'));
 const previous=process.env.LOCALAPPDATA;process.env.LOCALAPPDATA=dir;
 try{
  await localManager({id:'outlook-email',action:'install'});
  for(const [input,want] of [['지메일 열어줘',['gmail']],['Gmail 열어줘',['gmail']],['아웃룩 이메일 열어줘',['outlook-email']],['지메일과 아웃룩 열어줘',['gmail','outlook-email']]]){
   const found=[];
   await runAgentLoop({input,settings:{toolAllow:['plugin_search','plugin_call']},context:{},maxSteps:1,
    chat:async(_m,f)=>JSON.stringify(f.properties.kind?{kind:'action',surface:'web',access:'operate',desktop:'none',session:'any',goal:input,steps:[],tools:['plugin_search','plugin_call'],criteria:[],done_when:'열림',missing:''}:{tool:'reply',text:'확인',path:'',thought:''}),
    execute:async action=>{if(action.tool==='plugin_search')found.push(action.text);return [];}});
   assert.deepEqual(found,want,input);
  }
 }finally{if(previous===undefined)delete process.env.LOCALAPPDATA;else process.env.LOCALAPPDATA=previous;await fs.rm(dir,{recursive:true,force:true});}
});
