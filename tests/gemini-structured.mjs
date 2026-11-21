import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';

const root=process.env.TEST_APP_ROOT||decodeURIComponent(new URL('../',import.meta.url).pathname).replace(/^\/(\w:)/,'$1');
test('cloud aliases use HTTP only, missing keys and HTTP failures never launch CLI',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'api-fixture-'));
  const oldFetch=globalThis.fetch;
  const keys=['LOCALAPPDATA','GEMINI_API_KEY','OPENAI_API_KEY','ANTHROPIC_API_KEY'];
  const previous=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
  t.after(()=>{globalThis.fetch=oldFetch;for(const k of keys){if(previous[k]===undefined)delete process.env[k];else process.env[k]=previous[k];}});
  process.env.LOCALAPPDATA=dir;
  for(const k of keys.slice(1))process.env[k]='test-only-not-a-real-key';
  await fs.copyFile(path.join(root,'cloud-brain.mjs'),path.join(dir,'cloud-brain.mjs'));
  await fs.copyFile(path.join(root,'context-size.mjs'),path.join(dir,'context-size.mjs'));
  await fs.copyFile(path.join(root,'brain-health.mjs'),path.join(dir,'brain-health.mjs'));
  await fs.copyFile(path.join(root,'app-data.mjs'),path.join(dir,'app-data.mjs'));
  for(const name of ['gemini.mjs','codex-account.mjs','claude-account.mjs'])await fs.writeFile(path.join(dir,name),"throw Error('CLI_ROUTE_USED');");
  const cloud=await import(pathToFileURL(path.join(dir,'cloud-brain.mjs')));
  let calls=[];
  globalThis.fetch=async(url,opts)=>{calls.push(String(url));return {ok:true,text:async()=>JSON.stringify({candidates:[{content:{parts:[{text:'API OK'}]}}],choices:[{message:{content:'API OK'}}],content:[{type:'text',text:'API OK'}]})};};
  for(const p of ['gemini','gpt','claude','api-gemini','api-gpt','api-claude']){
    await t.test(p,async()=>{const b=await cloud.selectedBrain(p);assert.equal(await b.complete([{role:'user',content:'hello'}]),'API OK');});
  }
  assert.equal(calls.length,6);
  delete process.env.GEMINI_API_KEY;
  await assert.rejects(async()=> (await cloud.selectedBrain('gemini')).complete([{role:'user',content:'hello'}]),/API 키/);
  assert.equal(calls.length,6);
  process.env.GEMINI_API_KEY='test-only-not-a-real-key';
  globalThis.fetch=async()=>({ok:false,status:401,text:async()=>'unauthorized'});
  await assert.rejects(async()=> (await cloud.selectedBrain('gemini')).complete([{role:'user',content:'hello'}]),/키가 맞지|권한/);
});

test('Gemini helper uses API and refuses direct CLI coding',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'helper-fixture-'));
  await fs.copyFile(path.join(root,'gemini.mjs'),path.join(dir,'gemini.mjs'));
  await fs.writeFile(path.join(dir,'제미나이설정.json'),JSON.stringify({command:path.join(dir,'absent-cli.exe')}));
  await fs.writeFile(path.join(dir,'cloud-brain.mjs'),`export function extractJson(s){return JSON.parse(s)};export async function providers(){return ['gemini']};export async function selectedBrain(){return {status:async()=>({ok:true})}};export async function chat(messages,options){if(options.provider!=='gemini')throw Error('wrong provider');return {text:options.format?'{}':'API answer'}};`);
  const g=await import(pathToFileURL(path.join(dir,'gemini.mjs')));
  assert.equal((await g.ask('question')).text,'API answer');
  await assert.rejects(()=>g.ask('edit',{cwd:dir,autoApprove:true}),/API|CLI/);
  assert.equal(await g.complete([{role:'user',content:'hello'}]),'API answer');
});

test('app tool registry retains file editing but removes CLI coding',async()=>{
  const {availableTools}=await import(pathToFileURL(path.join(root,'agent-loop.mjs')));
  for(const brain of ['mix','gemini','api-gemini','api-gpt','api-claude']){
    const names=availableTools({brain});
    assert.ok(names.includes('write')&&names.includes('edit'));
    assert.ok(!names.includes('gemini_code'));
    // 2026-11-16: 모델이 Gemini에게 묻는 도구는 어떤 모드에서도 주지 않습니다.
    assert.ok(!names.includes('ask_gemini'));
  }
});
