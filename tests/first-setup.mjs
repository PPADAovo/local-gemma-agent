import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {runFirstSetup,recommendModel} from '../first-setup.mjs';

test('model recommendation: an installed model that fits the graphics card wins; otherwise pick by memory',()=>{
  const rank=['gemma4:12b','qwen3.5:35b','qwen3.5:9b'];
  assert.equal(recommendModel({vram:16,ram:64,installed:['qwen3.5:35b','gemma4:12b'],fitsGPU:n=>n==='gemma4:12b',rank}).name,'gemma4:12b');
  assert.equal(recommendModel({vram:16,ram:64,installed:[],rank}).name,'gemma4:12b');
  assert.equal(recommendModel({vram:8,ram:32,installed:[],rank}).name,'qwen3.5:9b');
  assert.equal(recommendModel({vram:null,ram:16,installed:[],rank}).name,'gemma4:e4b');
});

test('the setup walks through RAM, Ollama, model, connections, nickname and approval, then marks itself done',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'setup-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const steps=[],emitted=[],asked=[];let nick='';
  const out=await runFirstSetup({progress:s=>steps.push(s),emit:l=>emitted.push(l),dataDir:dir,
    fetchImpl:async()=>({ok:true}),probe:async()=>({ramTotal:63.7,vramTotal:16}),listInstalled:async()=>['gemma4:12b'],fitsGPU:n=>n==='gemma4:12b',rank:['gemma4:12b'],
    checks:{codex:async()=>true,gmail:async()=>false},saveNickname:async n=>{nick=n;},
    ask:async card=>{asked.push(card.title);return card.title.includes('불러')?'길동님':card.options.find(o=>o.startsWith('나 대신'));}});
  assert.deepEqual(steps.filter(s=>/^\d\/5/.test(s)).map(s=>s.slice(0,3)),['1/5','2/5','3/5','4/5','5/5']);
  assert.match(out.answer,/RAM \| 64GB/);
  assert.match(out.answer,/✅ gemma4:12b/);
  assert.match(out.answer,/Codex\(ChatGPT\) 계정 \| ✅/);
  assert.match(out.answer,/Gmail \| ⬜ 연결 안 됨/);
  assert.equal(nick,'길동님');
  assert.ok(emitted.includes('@prefs {"nickname":"길동님"}'));
  assert.ok(emitted.includes('@prefs {"approval":"auto"}'));
  assert.ok(!asked.includes('모델 내려받기'),'an installed model must not trigger a download');
  await fs.access(path.join(dir,'setup-done.json'));
  assert.equal(out.complete,true);
});

test('without Ollama the card waits and moves on by itself once Ollama starts',async()=>{
  let up=false;const steps=[];
  const out=await runFirstSetup({progress:s=>steps.push(s),fetchImpl:async()=>({ok:up}),probe:async()=>({ramTotal:16,vramTotal:null}),listInstalled:async()=>['gemma4:e4b'],rank:[],checks:{},
    ask:async card=>{if(card.title.startsWith('Ollama')){up=true;assert.equal(await card.until(),true);return card.untilAnswer;}return card.options?.[0]==='건너뛰기'?'건너뛰기':card.options[1];}});
  assert.match(out.answer,/Ollama \| ✅/);
  assert.match(out.answer,/gemma4:e4b/);
});
