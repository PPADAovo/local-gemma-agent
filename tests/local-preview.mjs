import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {startPreview} from '../preview-server.mjs';

test('local preview loads a Korean filename and sibling assets without publishing project notes',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gemma-preview-test-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const file=path.join(dir,'학사 일정.html');
  await fs.writeFile(file,'<link rel="stylesheet" href="style.css">');
  await fs.writeFile(path.join(dir,'style.css'),'body { color: navy }');
  await fs.writeFile(path.join(dir,'notes.md'),'회의 메모');
  const server=await startPreview(file);t.after(()=>server.close());
  assert.match(await (await fetch(server.url)).text(),/style\.css/);
  assert.equal(await (await fetch(new URL('style.css',server.url))).text(),'body { color: navy }');
  assert.equal((await fetch(new URL('notes.md',server.url))).status,404);
  assert.equal((await fetch(new URL('/',server.url))).status,404);
});
