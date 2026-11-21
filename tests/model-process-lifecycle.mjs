import test from 'node:test';
import assert from 'node:assert/strict';
import {stopModelProcess,stopModelProcessSync,watchModelProcess} from '../model-process-lifecycle.mjs';
test('Windows termination targets the controlled process tree before direct fallback',async()=>{
 const calls=[];const child={pid:12345,kill(){calls.push('parent');}};
 await stopModelProcess(child,{platform:'win32',run:(exe,args,options,done)=>{calls.push({exe,args,options});done(null);}});
 assert.deepEqual(calls[0].args,['/T','/F','/PID','12345']);assert.equal(calls[0].options.windowsHide,true);assert.equal(calls.length,1);
 await stopModelProcess(child,{platform:'win32',run:(_exe,_args,_options,done)=>{calls.push('tree failed');done(Error('not found'));}});
 assert.deepEqual(calls.slice(-2),['tree failed','parent']);
});
test('cancellation settles only after terminating the owned child',async()=>{
 const controller=new AbortController();let killed=false;const child={kill(){killed=true;}};
 const result=new Promise(resolve=>watchModelProcess(child,{signal:controller.signal},1000,e=>{assert.equal(killed,true);resolve(e);}));
 controller.abort(Error('cancel fixture'));assert.match((await result).message,/cancel fixture/);
});
test('exit cleanup uses a bounded synchronous Windows tree stop',()=>{
 let stopped=false;stopModelProcessSync({pid:12345},{platform:'win32',run:(exe,args,options)=>{assert.equal(exe,'taskkill.exe');assert.deepEqual(args,['/T','/F','/PID','12345']);assert.equal(options.windowsHide,true);assert.equal(options.timeout,2000);stopped=true;}});assert.equal(stopped,true);
});
