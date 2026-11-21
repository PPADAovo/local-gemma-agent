import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createInterface} from 'node:readline';
import {randomUUID} from 'node:crypto';

test('one approval covers all listed read-only URLs in the same request',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gemma-network-mode-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true,maxRetries:5}));
  const root=new URL('../',import.meta.url);
  for(const file of await fs.readdir(root))if(file.endsWith('.mjs'))await fs.copyFile(new URL(file,root),path.join(dir,file));
  const profile=path.join(dir,'LocalGemmaDesktop');await fs.mkdir(profile);
  await fs.mkdir(path.join(dir,'대화기록','inbox'),{recursive:true});
  await fs.writeFile(path.join(dir,'mock.mjs'),[
    "const real=globalThis.fetch;globalThis.fetch=async (url,options)=>{if(!String(url).startsWith('http://127.0.0.1:11434/'))return real(url,options);",
    "if(String(url).endsWith('/tags'))return Response.json({models:[{name:'qwen3.5:9b'}]});",
    "if(String(url).endsWith('/chat'))return Response.json({message:{content:'자료 확인'}});return Response.json({details:{}});};"
  ].join('\n'));
  let hits=[];
  const server=http.createServer((req,res)=>{hits.push(req.url);res.writeHead(200,{'content-type':'text/html'});res.end('<main>자료</main>');});
  await new Promise(ok=>server.listen(0,'127.0.0.1',ok));t.after(()=>server.close());
  const base='http://127.0.0.1:'+server.address().port;
  const text=base+'/one '+base+'/two 내용을 읽고 요약해줘';
  for(const [mode,answers,expected] of [['confirm',['거부'],[]],['confirm',['승인'],['/one','/two']],['auto',[],['/one','/two']],['full',[],['/one','/two']]]){
    hits=[];const cards=[],id=randomUUID();
    await fs.writeFile(path.join(profile,'preferences.json'),JSON.stringify({loopMode:'legacy',approval:mode,brain:'local',model:'qwen3.5:9b',webEnabled:true,webMode:'always'}));
    const child=spawn(process.execPath,['--import','./mock.mjs','agent.mjs','--rpc','--project',dir],{cwd:dir,windowsHide:true,env:{...process.env,LOCALAPPDATA:dir,LOCAL_GEMMA_MEMORY_SAMPLE:JSON.stringify({recordedAt:Date.now(),resident:[],available:24})}});
    const end=once(child,'close');const timeout=setTimeout(()=>child.kill(),20000);let errors='';
    try{
      child.stdout.resume();child.stdin.end(JSON.stringify({method:'ask',id,text,webGrant:text}));
      for await(const line of createInterface({input:child.stderr})){
        errors+=line+'\n';if(!line.startsWith('@ask '))continue;
        const card=JSON.parse(line.slice(5));cards.push(card);
        await fs.appendFile(path.join(dir,'대화기록','inbox',id+'.jsonl'),JSON.stringify({askId:card.askId,answer:answers[cards.length-1]||'거부'})+'\n');
      }
      const [code]=await end;
      assert.equal(cards.length,answers.length,mode+': '+errors);
      if(cards.length){assert.ok(cards[0].question.includes(base+'/one'));assert.ok(cards[0].question.includes(base+'/two'));}
      assert.deepEqual(hits,expected,mode+': '+errors);
      if(!answers.includes('거부'))assert.equal(code,0,errors);
    }finally{clearTimeout(timeout);child.kill();}
  }
});
