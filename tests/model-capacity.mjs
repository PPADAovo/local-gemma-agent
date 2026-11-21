import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {modelCapacity} from '../model-capacity.mjs';

test('GPU budget excludes memory reserved by other applications',()=>{
  const capacity=modelCapacity(64,40,40,[{total:16,free:8}],[],'gemma4:26b');
  assert.equal(capacity.vramTotal,16);
  assert.equal(capacity.vramAvailable,8);
});

test('GPU budget credits only the selected reusable model and never exceeds the adapter',()=>{
  const runners=[{name:'gemma4:26b',size_vram:8*1024**3},{name:'other-model',size_vram:4*1024**3}];
  assert.equal(modelCapacity(64,40,40,[{total:16,free:2}],runners,'gemma4:26b').vramAvailable,10);
  assert.equal(modelCapacity(64,40,40,[{total:16,free:11}],runners,'gemma4:26b').vramAvailable,16);
  assert.equal(modelCapacity(64,40,40,[{total:16,free:2},{total:12,free:5}],runners,'gemma4:26b').vramAvailable,5);
  assert.equal(modelCapacity(64,40,40,[],runners,'gemma4:26b').vramAvailable,null);
});

function fixture(){
  const models=[{name:'gemma4:26b',size:14*1024**3},{name:'qwen3.5:9b',size:7*1024**3}];
  globalThis.fetch=async url=>{
    const route=new URL(url).pathname;
    if(route==='/api/tags'||route==='/api/ps')return Response.json({models});
    if(route==='/api/show')return Response.json({details:{}});
    throw Error('Unexpected request; no inference is allowed: '+url);
  };
}

test('automatic RPC model selection respects available VRAM while preserving an explicit selection',{timeout:30000},async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gemma-gpu-capacity-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true,maxRetries:5}));
  const source=new URL('../',import.meta.url);
  for(const file of await fs.readdir(source))if(file.endsWith('.mjs'))await fs.copyFile(new URL(file,source),path.join(dir,file));
  await fs.mkdir(path.join(dir,'작업공간'));
  const settings=path.join(dir,'LocalGemmaDesktop');await fs.mkdir(settings);
  await fs.writeFile(path.join(dir,'fixture.mjs'),'('+fixture.toString()+')();');
  for(const [label,available,selected,expected] of [
    ['other applications reserve half the GPU',8,'','qwen3.5:9b'],
    ['legacy capacity sample falls back to total',undefined,'','gemma4:26b'],
    ['user selection remains fixed despite pressure',8,'gemma4:26b','gemma4:26b']
  ])await t.test(label,async t=>{
    await fs.writeFile(path.join(settings,'preferences.json'),JSON.stringify({brain:'local',model:selected}));
    const sample={recordedAt:Date.now(),hostReady:true,available:40,resident:[],vramTotal:16,...(available===undefined?{}:{vramAvailable:available})};
    const child=spawn(process.execPath,['--import','./fixture.mjs','agent.mjs','--rpc'],{cwd:dir,windowsHide:true,
      env:{...process.env,LOCALAPPDATA:dir,LOCAL_GEMMA_MEMORY_SAMPLE:JSON.stringify(sample)}});
    t.after(()=>child.kill());let output='',errors='';
    child.stdout.setEncoding('utf8').on('data',chunk=>output+=chunk);
    child.stderr.setEncoding('utf8').on('data',chunk=>errors+=chunk);
    const closed=once(child,'close');child.stdin.end(JSON.stringify({method:'warmup'}));
    const [code]=await closed;assert.equal(code,0,errors);
    assert.equal(JSON.parse(output).model,expected);
  });
});
