import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {sessionComplete,closeSession} from '../gemini-session.mjs';
test('a CLI that never initializes is stopped instead of waiting forever',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const child=new EventEmitter();Object.assign(child,{stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough(),kill(){this.killed=true;}});
 const result=sessionComplete([{role:'user',content:'hello'}],{type:'object'},{exe:'fixture',spawnProcess:()=>child});
 let settled=false;const caught=result.catch(e=>{settled=true;return e;});
 t.after(()=>closeSession());
 t.mock.timers.tick(30001);await Promise.resolve();await Promise.resolve();await Promise.resolve();
 assert.equal(settled,true,'initialization must have a deadline');
 assert.equal(child.killed,true);
 assert.match((await caught).message,/시작|연결/);
});
test('an initialized session returns the result and clears its startup deadline',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const child=new EventEmitter();Object.assign(child,{stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough(),kill(){this.killed=true;}});
 t.after(()=>closeSession());
 child.stdin.on('data',()=>queueMicrotask(()=>child.stdout.write(JSON.stringify({event:'result',result:{status:'SUCCESS',response:'{"tool":"reply","text":"done"}'}})+'\n')));
 const result=sessionComplete([{role:'user',content:'hello'}],{type:'object'},{exe:'fixture',spawnProcess:()=>child});
 child.stdout.write('{"event":"init"}\n');
 assert.equal(JSON.parse(await result).text,'done');
 t.mock.timers.tick(30001);
 assert.notEqual(child.killed,true);
});
test('caller cancellation closes an initializing session and rejects its pending request',async t=>{
 const child=new EventEmitter();Object.assign(child,{stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough(),kill(){this.killed=true;}});
 t.after(()=>closeSession());const controller=new AbortController();
 const result=sessionComplete([{role:'user',content:'cancel initialization'}],{type:'object'},{exe:'fixture',spawnProcess:()=>child,signal:controller.signal});
 const rejection=assert.rejects(result,/caller cancellation/);controller.abort(Error('caller cancellation'));
 // Old code ignores the signal; closing explicitly releases it for a bounded failing test.
 const release=setTimeout(()=>child.emit('error',Error('ignored caller cancellation')),50);
 await rejection;clearTimeout(release);assert.equal(child.killed,true);
});
