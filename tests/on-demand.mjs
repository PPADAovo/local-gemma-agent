import assert from 'node:assert/strict';
import {test} from 'node:test';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,mkdir,copyFile,readdir,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fitsCapacity} from '../model-capacity.mjs';

test('resident model remains eligible with little spare memory',()=>{
  assert.equal(fitsCapacity(22,'qwen3.5:35b',{hostReady:false,available:0,resident:['qwen3.5:35b']}),true);
});

function mockOllama(){
  const models=[{name:'qwen3.5:35b',size:22*1024**3},{name:'qwen3.5:9b',size:7*1024**3}];
  globalThis.fetch=async (url,options={})=>{
    const route=new URL(url).pathname;
    if(route==='/api/tags')return Response.json({models});
    if(route==='/api/show')return Response.json({details:{}});
    if(route==='/api/chat'){
      const payload=JSON.parse(options.body);
      if(payload.model===models[0].name)return Response.json({error:'out of memory'},{status:500});
      return Response.json({done:true,message:{content:'작은 모델 응답'}});
    }
    throw Error('Unexpected endpoint '+url);
  };
}

test('automatic chat retries an allocation error using the smaller installed model',async t=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'gemma-model-test-'));
  t.after(()=>rm(dir,{recursive:true,force:true,maxRetries:5}));
  const source=new URL('../',import.meta.url);
  for(const file of await readdir(source)){
    if(file.endsWith('.mjs'))await copyFile(new URL(file,source),path.join(dir,file));
  }
  await mkdir(path.join(dir,'작업공간'));
  await writeFile(path.join(dir,'fixture.mjs'),'('+mockOllama.toString()+')();');
  const child=spawn(process.execPath,['--import','./fixture.mjs','agent.mjs','--rpc'],{
    cwd:dir,windowsHide:true,env:{...process.env,LOCALAPPDATA:dir,
      LOCAL_GEMMA_MEMORY_SAMPLE:JSON.stringify({recordedAt:Date.now(),hostReady:true,available:40,resident:[]})}
  });
  let output='',log='';
  child.stdout.setEncoding('utf8').on('data',d=>output+=d);
  child.stderr.setEncoding('utf8').on('data',d=>log+=d);
  const closed=once(child,'close');
  child.stdin.end(JSON.stringify({method:'ask',id:crypto.randomUUID(),textOnly:true,text:'응답해줘'}));
  const [code]=await closed;
  assert.equal(code,0,log);
  assert.match(log,/qwen3\.5:35b 메모리 할당 실패/);
  assert.match(log,/qwen3\.5:9b 모델 연결/);
  assert.equal(JSON.parse(output).answer,'작은 모델 응답');
});
