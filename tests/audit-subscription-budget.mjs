import test from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {complete as codex} from '../codex-account.mjs';
import {complete as claude} from '../claude-account.mjs';
for(const [name,complete] of [['codex',codex],['claude',claude]])test(name+' rejects cancelled work before authentication or CLI launch',async t=>{
 let calls=0;const mock=t.mock.method(childProcess,'execFile',(...args)=>{calls++;const cb=args.at(-1);queueMicrotask(()=>cb(Error('fixture auth denied'),'',''));return {stdin:{on(){},end(){}}};});syncBuiltinESMExports();t.after(()=>{mock.mock.restore();syncBuiltinESMExports();});
 const controller=new AbortController();controller.abort(Error('cancelled before launch'));
 await assert.rejects(complete([{role:'user',content:'fixture'}],null,{signal:controller.signal}),/cancelled before launch/);
 assert.equal(calls,0);
});
