import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {loadConfig} from '../cloud-brain.mjs';

test('unchanged provider config is read once and invalidated after an edit or removal',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'config-cache-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const file=path.join(dir,'config.json');await fs.writeFile(file,JSON.stringify({gemini:{models:['first']}}));
  const original=fs.readFile;let reads=0;
  fs.readFile=async function(p,...rest){if(String(p)===file)reads++;return original.call(this,p,...rest);};
  try{
    const first=await loadConfig(file);first.gemini.models.push('must-not-leak');
    assert.deepEqual((await loadConfig(file)).gemini.models,['first']);
    assert.equal(reads,1,'unchanged config must not be read for every inference');
    await fs.writeFile(file,JSON.stringify({gemini:{models:['changed-longer']}}));
    assert.deepEqual((await loadConfig(file)).gemini.models,['changed-longer']);
    await fs.unlink(file);assert.ok(!(await loadConfig(file)).gemini.models.includes('changed-longer'));
  }finally{fs.readFile=original;}
});

test('environment key changes invalidate cached configuration without exposing the key',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'config-env-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const file=path.join(dir,'config.json');await fs.writeFile(file,'{}');
  const previous=process.env.GEMINI_API_KEY;
  try{process.env.GEMINI_API_KEY='fixture-one';assert.equal((await loadConfig(file)).gemini.key,'fixture-one');
    process.env.GEMINI_API_KEY='fixture-two';assert.equal((await loadConfig(file)).gemini.key,'fixture-two');
  }finally{if(previous===undefined)delete process.env.GEMINI_API_KEY;else process.env.GEMINI_API_KEY=previous;}
});
