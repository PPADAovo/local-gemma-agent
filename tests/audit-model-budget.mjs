import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createConversation} from '../conversation.mjs';
import {chat} from '../cloud-brain.mjs';
import {runSimpleLoop} from '../simple-loop.mjs';
test('loop deadline is forwarded to the local model transport',async()=>{
 let read=false;const timeouts=[];
 const app=createConversation({model:'test',settings:{noSpec:true,taskTimeoutMs:500,computerUse:false},execute:async()=>{read=true;return 'ok';},localChat:async(payload,timeout)=>{timeouts.push(timeout);return Response.json({done_reason:'stop',message:{content:JSON.stringify(payload.format?.properties?.verified?{verified:true,quote:'ok',gap:''}:read?{tool:'reply',text:'ok'}:{tool:'read',path:'audit.txt'})}});}});
 await app.ask('audit.txt 내용을 읽어 줘');assert.ok(timeouts.length>0);assert.ok(timeouts.every(n=>n<=500),JSON.stringify(timeouts));
});
test('cloud cancellation aborts the HTTP transport without fallback or health poisoning',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'budget-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const file=path.join(dir,'config.json');
 await fs.writeFile(file,JSON.stringify({order:['gpt'],gpt:{key:'fixture-not-real-key',models:['fixture','fallback'],url:'https://fixture.invalid'}}));
 const previous=globalThis.fetch;t.after(()=>{globalThis.fetch=previous;});let calls=0,aborted=false;
 globalThis.fetch=async(_url,{signal})=>{calls++;return new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('fixture transport did not cancel')),100);signal.addEventListener('abort',()=>{clearTimeout(timer);aborted=true;reject(signal.reason);},{once:true});});};
 const controller=new AbortController();setTimeout(()=>controller.abort(new DOMException('cancelled','AbortError')),20);
 await assert.rejects(chat([{role:'user',content:'fixture'}],{file,provider:'gpt',signal:controller.signal,deadline:Date.now()+100}),/cancelled|시간|제한/);
 assert.equal(calls,1);assert.equal(aborted,true);assert.equal(await fs.stat(file+'.models.json').then(()=>true,()=>false),false);
});
test('simple loop keeps one successful memory flush across later compactions',async()=>{
 let turns=0,saves=0,summaries=0;
 await runSimpleLoop({input:'긴 자료 확인',maxSteps:24,context:{contextWindow:8192,saveMemory:async()=>{saves++;}},
 chatMessage:async({tools,format})=>{if(format){return {content:JSON.stringify({memory:['자료를 확인하는 작업입니다'],note:''})};}if(!tools){summaries++;return {content:'자료 확인 중'};}return turns++<20?{tool_calls:[{function:{name:'read',arguments:{path:'part'+turns}}}]}:{content:'완료했습니다.'};},execute:async()=> '가'.repeat(3000)});
 assert.ok(summaries>1);assert.equal(saves,1);
});
test('simple loop deadline preserves successful observations and cancels later generation',{timeout:500},async()=>{
 let calls=0,aborted=false;
 const result=await runSimpleLoop({input:'자료 확인',settings:{taskTimeoutMs:30},execute:async()=> 'observed',chatMessage:async({signal})=>{
  if(!calls++)return {tool_calls:[{function:{name:'read',arguments:{path:'fixture'}}}]};
  return new Promise((_,reject)=>signal?.addEventListener('abort',()=>{aborted=true;reject(signal.reason);},{once:true}));
 }});
 assert.equal(result.complete,false);assert.equal(result.events[0].ok,true);assert.equal(aborted,true);
});
