import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {runAgentLoop} from '../agent-loop.mjs';

test('a user update arriving during inference invalidates the pending action',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gemma-update-'));
  const old=process.env.GEMMA_INBOX;
  const inbox=path.join(dir,'inbox.jsonl');
  process.env.GEMMA_INBOX=inbox;
  t.after(async()=>{
    if(old===undefined)delete process.env.GEMMA_INBOX;else process.env.GEMMA_INBOX=old;
    await fs.rm(dir,{recursive:true,force:true});
  });
  let calls=0;
  const result=await runAgentLoop({
    input:'목록 봐줘',settings:{noSpec:true,computerUse:false},context:{},maxSteps:3,
    chat:async messages=>{
      if(++calls===1){
        await fs.writeFile(inbox,JSON.stringify({text:'무료인 항목만'})+'\n');
        return JSON.stringify({tool:'list',path:'stale',text:''});
      }
      assert(messages.some(m=>m.content.includes('무료인 항목만')));
      await fs.appendFile(inbox,JSON.stringify({text:'취소'})+'\n');
      return JSON.stringify({tool:'list',path:'also-stale',text:''});
    },
    execute:()=>assert.fail('an outdated decision reached the tool')
  });
  assert.deepEqual(result.injected,['무료인 항목만','취소']);
  assert.equal(result.complete,false);
  assert.equal(calls,2);
});
