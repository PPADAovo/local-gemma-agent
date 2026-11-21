import test from 'node:test';import assert from 'node:assert/strict';import http from 'node:http';import {modelProfile,loadedContext} from '../context-size.mjs';
test('model metadata requests honor caller cancellation and do not cache aborted fallback',async()=>{
 let reply=false;const server=http.createServer((req,res)=>{if(reply)res.end(JSON.stringify({model_info:{'general.architecture':'test','test.context_length':12345},models:[]}));});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const endpoint='http://127.0.0.1:'+server.address().port;
 try{for(const fn of [modelProfile,loadedContext]){const started=Date.now();await assert.rejects(fn(endpoint,'audit-model',{signal:AbortSignal.timeout(80)}),/abort|timeout/i);assert.ok(Date.now()-started<1000);}
 reply=true;assert.equal((await modelProfile(endpoint,'audit-model')).max,12345);
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
