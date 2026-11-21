import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
test('text-only Claude subscription rejects image decisions before starting authentication or inference',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'claude-vision-contract-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  await fs.copyFile(new URL('../claude-account.mjs',import.meta.url),path.join(dir,'claude-account.mjs'));
  await fs.writeFile(path.join(dir,'model-process-lifecycle.mjs'),'export async function execModelProcess(){throw Error("AUTH_OR_INFERENCE_CALLED")}');
  await fs.writeFile(path.join(dir,'cloud-brain.mjs'),'export const extractJson=JSON.parse;');
  const provider=await import(pathToFileURL(path.join(dir,'claude-account.mjs')).href);
  await assert.rejects(provider.complete([{role:'user',content:'이 화면의 저장 버튼 위치',images:['fixture']}],{}),error=>error.code==='VISION_UNSUPPORTED'&&/이미지|화면/.test(error.message));
  await assert.rejects(provider.complete([{role:'user',content:'참조 디자인과 현재 화면 비교',images:['reference','current']}],{}),error=>error.code==='VISION_UNSUPPORTED','unsupported multi-image requests must fail explicitly before inference');
});
