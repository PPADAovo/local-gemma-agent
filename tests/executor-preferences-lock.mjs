import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {withPreferencesWriteLock} from '../preferences-write-lock.mjs';
import {execFile} from 'node:child_process';import {promisify} from 'node:util';
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function fixture(fn){const root=await fs.mkdtemp(path.join(os.tmpdir(),'gemma-prefs-test-'));try{await fn(path.join(root,'preferences.json'));}finally{assert.equal(path.dirname(root),os.tmpdir().replace(/[\\/]$/,''));await fs.rm(root,{recursive:true,force:true});}}
test('concurrent preference updates preserve both independently changed fields',()=>fixture(async file=>{await fs.writeFile(file,'{}');await Promise.all(['a','b'].map(key=>withPreferencesWriteLock(file,async()=>{const current=JSON.parse(await fs.readFile(file,'utf8'));await delay(30);current[key]=true;await fs.writeFile(file,JSON.stringify(current));})));assert.deepEqual(JSON.parse(await fs.readFile(file,'utf8')),{a:true,b:true});await assert.rejects(fs.stat(file+'.write.lock'),{code:'ENOENT'});}));
test('a live process lock is not removed and fails within the wait budget',()=>fixture(async file=>{await fs.writeFile(file+'.write.lock',String(process.pid));await assert.rejects(withPreferencesWriteLock(file,()=>assert.fail('must not enter'),{timeoutMs:50}),/설정.*저장|잠금/);assert.equal(await fs.readFile(file+'.write.lock','utf8'),String(process.pid));}));
test('an abandoned empty lock is recovered and thrown updates release ownership',()=>fixture(async file=>{const lock=file+'.write.lock';await fs.writeFile(lock,'');const old=new Date(Date.now()-120000);await fs.utimes(lock,old,old);await assert.rejects(withPreferencesWriteLock(file,async()=>{throw Error('fixture');}),/fixture/);await assert.rejects(fs.stat(lock),{code:'ENOENT'});}));
test('two actual Node writers reclaim a dead-owner lock without overlapping ownership or lost updates',{timeout:30000},()=>fixture(async file=>{
 const deadPid=await new Promise((resolve,reject)=>{const child=execFile(process.execPath,['-e',''],{windowsHide:true},error=>error?reject(error):resolve(child.pid));});
 const run=promisify(execFile),module=new URL('../preferences-write-lock.mjs',import.meta.url).href;
 const program=`import fs from 'node:fs/promises';const [module,file,gate,role]=process.argv.slice(1);const {withPreferencesWriteLock}=await import(module);const sleep=ms=>new Promise(r=>setTimeout(r,ms));await fs.writeFile(gate+'.'+role+'.ready','');while(!await fs.stat(gate).catch(()=>null))await sleep(2);await withPreferencesWriteLock(file,async()=>{const active=file+'.active';await fs.writeFile(active,role,{flag:'wx'});try{const state=JSON.parse(await fs.readFile(file,'utf8'));await sleep(60);state[role]=true;await fs.writeFile(file,JSON.stringify(state));}finally{await fs.unlink(active);}});`;
 for(let round=0;round<6;round++){
  const gate=file+'.start-'+round;await fs.writeFile(file,'{}');await fs.writeFile(file+'.write.lock',String(deadPid));
  const workers=['a','b'].map(role=>run(process.execPath,['--input-type=module','-e',program,module,file,gate,role],{windowsHide:true,timeout:8000}));
  const deadline=Date.now()+5000;while(!await fs.stat(gate+'.a.ready').catch(()=>null)||!await fs.stat(gate+'.b.ready').catch(()=>null)){assert.ok(Date.now()<deadline,'writers started');await delay(5);}
  await fs.writeFile(gate,'');await Promise.all(workers);assert.deepEqual(JSON.parse(await fs.readFile(file,'utf8')),{a:true,b:true},'round '+round);
  await assert.rejects(fs.stat(file+'.write.lock'),{code:'ENOENT'});
 }
}));
