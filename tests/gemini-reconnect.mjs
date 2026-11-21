import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';

async function fixture(t){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gemini-reconnect-'));
  const config=path.join(dir,'config.json');
  await fs.copyFile(new URL('../cloud-brain.mjs',import.meta.url),path.join(dir,'cloud-brain.mjs'));
  await fs.copyFile(new URL('../context-size.mjs',import.meta.url),path.join(dir,'context-size.mjs'));
  await fs.copyFile(new URL('../brain-health.mjs',import.meta.url),path.join(dir,'brain-health.mjs'));
  await fs.copyFile(new URL('../app-data.mjs',import.meta.url),path.join(dir,'app-data.mjs'));
  const cfg={order:['gemini'],gemini:{key:'fixture-key-first',models:['blocked-pro','working-flash'],url:'https://fixture.invalid'},timeoutSec:2,attemptTimeoutSec:2};
  await fs.writeFile(config,JSON.stringify(cfg));
  const old=globalThis.fetch;t.after(async()=>{globalThis.fetch=old;await fs.rm(dir,{recursive:true,force:true});});
  let requests=[];
  globalThis.fetch=async(url)=>{const model=decodeURIComponent(String(url).split('/models/')[1].split(':')[0]);requests.push(model);return model==='blocked-pro'?new Response(JSON.stringify({error:{message:'Quota exceeded, limit: 0',details:[{'@type':'type.googleapis.com/google.rpc.RetryInfo',retryDelay:'3600s'}]}}),{status:429}):new Response(JSON.stringify({candidates:[{content:{parts:[{text:'OK'}]}}]}));};
  const load=()=>import(pathToFileURL(path.join(dir,'cloud-brain.mjs')).href+'?run='+Math.random());
  return {dir,config,cfg,requests,load};
}
const messages=[{role:'user',content:'Reply OK.'}];
test('a new app request skips the same account model still in server cooldown',async t=>{
 const f=await fixture(t);
 assert.equal((await(await f.load()).chat(messages,{file:f.config,provider:'gemini'})).text,'OK');
 assert.deepEqual(f.requests,['blocked-pro','working-flash']);
 f.requests.length=0;
 assert.equal((await(await f.load()).chat(messages,{file:f.config,provider:'gemini'})).text,'OK');
 assert.deepEqual(f.requests,['working-flash']);
 const state=await fs.readFile(f.config+'.models.json','utf8');
 assert.equal(state.includes(f.cfg.gemini.key),false);
 const values=Object.values(JSON.parse(state));
 assert.ok(values[0].until-Date.now()>23*60*60e3, 'zero allocation stays unavailable for a day even if RetryInfo is shorter');
});
test('cached unavailable-model skips stay out of progress messages',async t=>{
 const f=await fixture(t);await(await f.load()).chat(messages,{file:f.config,provider:'gemini'});
 const progress=[];await(await f.load()).chat(messages,{file:f.config,provider:'gemini',onProgress:text=>progress.push(text)});
 assert.ok(progress.every(text=>!text.includes('blocked-pro')),progress.join('\n'));
});
test('replacing the API key does not inherit another account cooldown',async t=>{
 const f=await fixture(t);await(await f.load()).chat(messages,{file:f.config,provider:'gemini'});
 f.cfg.gemini.key='fixture-key-replacement';await fs.writeFile(f.config,JSON.stringify(f.cfg));f.requests.length=0;
 await(await f.load()).chat(messages,{file:f.config,provider:'gemini'});
 assert.deepEqual(f.requests,['blocked-pro','working-flash']);
});
test('only unavailable models does not repeat rejected API calls on every request',async t=>{
 const f=await fixture(t);f.cfg.gemini.models=['blocked-pro'];await fs.writeFile(f.config,JSON.stringify(f.cfg));
 await assert.rejects(()=>(async()=> (await f.load()).chat(messages,{file:f.config,provider:'gemini'}))(),/한도|사용 불가/);
 f.requests.length=0;
 await assert.rejects(()=>(async()=> (await f.load()).chat(messages,{file:f.config,provider:'gemini'}))(),/재시도|한도/);
 assert.deepEqual(f.requests,[]);
});
test('expired cooldown allows the preferred model to be checked again',async t=>{
 const f=await fixture(t);await(await f.load()).chat(messages,{file:f.config,provider:'gemini'});
 const state=JSON.parse(await fs.readFile(f.config+'.models.json','utf8'));
 for(const value of Object.values(state))value.until=Date.now()-1;
 await fs.writeFile(f.config+'.models.json',JSON.stringify(state));f.requests.length=0;
 await(await f.load()).chat(messages,{file:f.config,provider:'gemini'});
 assert.deepEqual(f.requests,['blocked-pro','working-flash']);
});
