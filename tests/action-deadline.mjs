import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {chat} from '../cloud-brain.mjs';

for(const action of [true,false])test(`a stalled action switches models promptly without shortening prose generation (${action})`,async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'action-deadline-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const file=path.join(dir,'config.json');await fs.writeFile(file,JSON.stringify({gemini:{key:'fixture-only-key',models:['slow','fast'],url:'https://fixture.invalid'}}));
  const deadlines=[],timeout=AbortSignal.timeout.bind(AbortSignal);t.mock.method(AbortSignal,'timeout',ms=>{deadlines.push(ms);return timeout(ms);});
  t.mock.method(globalThis,'fetch',async url=>{
    if(String(url).includes('/slow:'))throw new DOMException('timed out','TimeoutError');
    return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:action?'\u007b"tool":"reply","text":"done"\u007d':'done'}]}}]});
  });
  const result=await chat([{role:'user',content:'sample'}],{file,provider:'gemini',...(action?{format:{type:'object',properties:{tool:{type:'string'},text:{type:'string'}}}}:{})});
  assert.equal(result.model,'fast');assert.deepEqual(deadlines,action?[20000,20000]:[60000,60000]);
});
