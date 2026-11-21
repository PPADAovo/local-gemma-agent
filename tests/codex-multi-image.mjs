import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';

test('Codex subscription forwards all reference images and current screenshot in order',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'codex-multi-image-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  await fs.copyFile(new URL('../codex-account.mjs',import.meta.url),path.join(dir,'codex-account.mjs'));
  await fs.writeFile(path.join(dir,'model-process-lifecycle.mjs'),`import fs from 'node:fs/promises';
    export const calls=[];
    export async function execModelProcess(exe,args,options,input){
      if(args[0]==='login')return {stdout:'Logged in using ChatGPT',stderr:''};
      const files=args.flatMap((arg,index)=>arg==='-i'?[args[index+1]]:[]);
      calls.push({files,images:await Promise.all(files.map(async file=>(await fs.readFile(file)).toString('base64'))),input});
      await fs.writeFile(args[args.indexOf('-o')+1],'Synthetic answer');
      return {stdout:'',stderr:''};
    }`);
  const provider=await import(pathToFileURL(path.join(dir,'codex-account.mjs')));
  const fixture=await import(pathToFileURL(path.join(dir,'model-process-lifecycle.mjs')));
  const images=['reference A','reference B','current screenshot'].map(s=>Buffer.from(s).toString('base64'));
  assert.equal(await provider.complete([{role:'user',content:'Reference designs',images:images.slice(0,2),keep:true},{role:'user',content:'Current screen',images:images.slice(2)}]),'Synthetic answer');
  assert.deepEqual(fixture.calls[0].images,images);
  assert.ok(fixture.calls[0].input.includes('Reference designs')&&fixture.calls[0].input.includes('Current screen'));
  for(const file of fixture.calls[0].files)await assert.rejects(()=>fs.stat(file),{code:'ENOENT'});
});
