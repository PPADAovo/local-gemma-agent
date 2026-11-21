import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {actionContext,learnEpisode,rankRecoveryTools} from '../action-policy.mjs';
import {chooseNextRoute} from '../route-choice.mjs';

const readContext=actionContext({surface:'other',access:'observe'},false);
const action=(tool,text='',path='')=>({tool,text,path,thought:'관찰'});
const format={type:'object',properties:{tool:{type:'string'},text:{type:'string'},path:{type:'string'},thought:{type:'string'}},required:['tool','text','path','thought']};
const common={tools:['read','find_file','list','write'],format,request:'현재 폴더에서 보고서의 금액을 찾아줘',issue:'file not found',previous:action('read')};
const ranked=[{tool:'list',wins:2,support:2,score:.75},{tool:'find_file',wins:0,support:2,score:.25}];

test('learning stores only bounded labels and rewards observed results from separate verified episodes',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'policy-test-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  for(let i=0;i<2;i++){
    const events=[
      {ok:false,tool:'read',path:'private-marker.txt'},
      {ok:true,tool:'list',observation:'private-marker.txt'},
      {ok:true,tool:'read',path:'private-marker.txt',observation:'private-marker'},
    ];
    const receipt={criteria:['private-marker'],evidence:[{id:3,tool:'read',path:'private-marker.txt'}]};
    await learnEpisode(dir,readContext,events,receipt);
    await learnEpisode(dir,readContext,events,receipt);
    const failures=[{ok:false,tool:'read'},{ok:false,tool:'find_file'},
      {ok:true,tool:'read',path:'private-marker.txt',observation:'private-marker'}];
    await learnEpisode(dir,readContext,failures,receipt);
  }
  assert.deepEqual(await rankRecoveryTools(dir,readContext,'read',common.tools),ranked);
  assert.deepEqual(await rankRecoveryTools(dir,'web/operate','read',common.tools),[]);
  const before=await fs.readdir(dir);assert.equal(before.length,4);
  for(const name of before)assert.doesNotMatch(await fs.readFile(path.join(dir,name),'utf8'),/private-marker/);
  for(const evidence of [[],['private-marker'],[{id:7,tool:'read'}],[{id:2,tool:'read'}]]){
    await learnEpisode(dir,readContext,[{ok:false,tool:'read'},{ok:true,tool:'list',observation:'ok'}],{criteria:['met'],evidence});
  }
  assert.deepEqual(await fs.readdir(dir),before);
  assert.equal(actionContext({surface:'private-marker',access:'private-marker'},false),'other/unknown');
});

test('selection changes the concrete tool and retains model-grounded arguments only with earned support',async()=>{
  const primary=action('find_file','보고서','/example'),alternate=action('list','','/example/approved');
  const proposal={...primary,alternatives:[alternate]};
  const ask=async opts=>chooseNextRoute({...common,chat:async()=>JSON.stringify(proposal),...opts});
  assert.deepEqual((await ask({prior:ranked})).action,alternate);
  assert.deepEqual((await ask({prior:[]})).action,primary);
  assert.deepEqual((await ask({tools:['find_file'],prior:ranked})).action,primary);
  assert.deepEqual((await ask({prior:ranked,issue:'로그인 대기'})).action,primary);
  assert.deepEqual((await ask({prior:[{tool:'list',wins:1,support:1,score:.67}]})).action,primary);
});

test('policy cannot insert an unproposed action or preempt permission, authentication and stop',async()=>{
  for(const primary of [action('read'),action('ask_user','어떤 계정으로 로그인할까요?'),action('blocked','권한 거부'),action('write','authorized','approved.txt')]){
    const result=await chooseNextRoute({...common,prior:ranked,chat:async()=>JSON.stringify({...primary,alternatives:primary.tool==='read'?[]:[action('list')]})});
    if(['ask_user','blocked'].includes(primary.tool))assert.equal(result.decision,primary.tool==='ask_user'?'ask':'blocked');
    else assert.deepEqual(result.action,primary);
  }
});
