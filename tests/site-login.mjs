import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {loginForUser,maskInboxAnswers,MANUAL} from '../site-login.mjs';

const memoryStore=()=>{const data=new Map();return {data,save:async(h,c)=>data.set(h,{...c}),read:async h=>data.get(h)||null,forget:async h=>data.delete(h)};};

test('asks id and a secret password once, saves it, fills the page and scrubs the inbox',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'site-login-'));
  const inbox=path.join(dir,'inbox.jsonl');
  try{
    const asked=[],filled=[],store=memoryStore();
    const answers=['student01','S3cret-pw!'];
    const ask=async card=>{asked.push(card);const a=answers.shift();await fs.appendFile(inbox,JSON.stringify({askId:String(asked.length),answer:a})+'\n');return a;};
    const outcome=await loginForUser('hive.example.ac.kr',{fill:async c=>{filled.push(c);return {ok:true};},ask,store,inbox});
    assert.equal(outcome,'filled');
    assert.equal(asked.length,2);
    assert.equal(asked[1].secret,true);
    assert.ok(!JSON.stringify(asked).includes('S3cret-pw!'));
    assert.deepEqual(filled,[{username:'student01',password:'S3cret-pw!'}]);
    assert.deepEqual(store.data.get('hive.example.ac.kr'),{username:'student01',password:'S3cret-pw!'});
    const saved=await fs.readFile(inbox,'utf8');
    assert.ok(!saved.includes('S3cret-pw!') && !saved.includes('student01'),saved);
    assert.equal(saved.trim().split('\n').length,2);
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('uses saved credentials without asking, and asks again after a failed saved login',async()=>{
  const store=memoryStore();await store.save('portal.example.com',{username:'a',password:'old'});
  let asks=0;
  assert.equal(await loginForUser('portal.example.com',{fill:async()=>({ok:true}),ask:async()=>{asks++;return MANUAL;},store}),'filled');
  assert.equal(asks,0);
  assert.equal(await loginForUser('portal.example.com',{fill:async()=>({ok:true}),ask:async()=>{asks++;return MANUAL;},store,retry:true}),'manual');
  assert.equal(asks,1);
  assert.equal(store.data.has('portal.example.com'),false);
});

test('Google sign-in and manual choice are never auto-filled',async()=>{
  let filled=0;
  assert.equal(await loginForUser('accounts.google.com',{fill:async()=>{filled++;return {ok:true};},ask:async()=>'x',store:memoryStore()}),'manual');
  assert.equal(await loginForUser('site.example.com',{fill:async()=>{filled++;return {ok:true};},ask:async()=>MANUAL,store:memoryStore()}),'manual');
  assert.equal(filled,0);
});

test('masking keeps unrelated inbox lines',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'site-login-'));
  const inbox=path.join(dir,'inbox.jsonl');
  try{
    await fs.writeFile(inbox,JSON.stringify({text:'다른 지시'})+'\n'+JSON.stringify({askId:'1',answer:'pw'})+'\n');
    await maskInboxAnswers(['pw'],inbox);
    const lines=(await fs.readFile(inbox,'utf8')).trim().split('\n').map(l=>JSON.parse(l));
    assert.equal(lines[0].text,'다른 지시');
    assert.equal(lines[1].answer,'[가림]');
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
