import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,readdir,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import pngjs from '../라이브러리/pngjs/lib/png.js';
import {generateExternalImage} from '../external-image-generation.mjs';

const id='566d0a4f-2784-43c8-993c-9d7c2a306cbb';
async function setup(t,service){
  const dir=await mkdtemp(path.join(os.tmpdir(),'gemma-generation-test-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const calls=[];
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    const route=new URL(url).pathname.split('/generate/')[1];
    calls.push([options.method,route]);
    return service(route,options);
  });
  return {dir,file:path.join(dir,'example.png'),calls};
}

test('verified PNG and server-selected model are saved to a previously unused path',async t=>{
  const image=new pngjs.PNG({width:512,height:512,fill:true});
  const payload=pngjs.PNG.sync.write(image).toString('base64');
  const {file,calls}=await setup(t,(r,options)=>{
    assert.equal(options.headers.apikey,'0000000000');
    if(r==='async'){const body=JSON.parse(options.body);assert.equal(body.r2,false);assert.equal(body.prompt,'a pear');return Response.json({id},{status:202});}
    if(r==='check/'+id)return Response.json({done:true});
    return Response.json({generations:[{img:payload,model:'demo',state:'ok',censored:false}]});
  });
  const result=await generateExternalImage('a pear',file);assert.equal(result.model,'demo');
  assert.equal(result.width,512);assert.equal(result.height,512);
  assert.deepEqual((await readFile(file)).toString('base64'),payload);assert.equal(calls.length,3);
});
test('invalid bytes and censored generation leave no output',async t=>{
  for(const item of [{img:'ZmFrZQ==',model:'demo'},{img:'',censored:true}]){
    await t.test(JSON.stringify(item),async t=>{
      const {dir,file}=await setup(t,r=>Response.json(r==='async'?{id}:r.startsWith('check/')?{done:true}:{generations:[item]}));
      await assert.rejects(generateExternalImage('a pear',file));assert.deepEqual(await readdir(dir),[]);
    });
  }
});
test('cancelling during queue wait cancels the remote job once and leaves no file',async t=>{
  const abort=new AbortController();
  const {dir,file,calls}=await setup(t,(r,o)=>{
    if(r==='async')return Response.json({id},{status:202});
    if(r==='check/'+id){abort.abort();return Response.json({done:false,queue_position:3});}
    assert.equal(o.method,'DELETE');return Response.json({});
  });
  await assert.rejects(generateExternalImage('a pear',file,{signal:abort.signal}),{name:'AbortError'});
  assert(calls.some(([m,r])=>m==='DELETE'&&r==='status/'+id));assert.deepEqual(await readdir(dir),[]);
});
test('existing output is preserved without contacting the provider',async t=>{
  const {file,calls}=await setup(t,()=>assert.fail('should not contact service'));await writeFile(file,'original');
  await assert.rejects(generateExternalImage('a pear',file),/이미 있습니다/);assert.equal(await readFile(file,'utf8'),'original');assert.equal(calls.length,0);
});
test('busy anonymous service is reported without output or retry',async t=>{
  const {dir,file,calls}=await setup(t,()=>Response.json({message:'anonymous queue busy'},{status:429}));
  await assert.rejects(generateExternalImage('a pear',file),/429/);assert.deepEqual(await readdir(dir),[]);assert.equal(calls.length,1);
});
