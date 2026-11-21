import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {createInterface} from 'node:readline';

test('mail is prepared and reviewed once, empty attachments send plain text, and invalid input never asks',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gemma-mail-approval-'));
 try{
  for(const f of await fs.readdir(new URL('../',import.meta.url)))if(/\.(mjs|ps1)$/.test(f))await fs.copyFile(new URL('../'+f,import.meta.url),path.join(dir,f));
  await fs.mkdir(path.join(dir,'LocalGemmaDesktop'));await fs.mkdir(path.join(dir,'대화기록','inbox'),{recursive:true});
  await fs.writeFile(path.join(dir,'LocalGemmaDesktop','preferences.json'),JSON.stringify({loopMode:'legacy',model:'gemma4:26b',brain:'local',approval:'auto',noSpec:true,webEnabled:true,webMode:'always',showOverlay:false,memoryEnabled:false,toolAllow:['plugin_search','plugin_call']}));
  // External service boundary only: no email or other network request leaves this test.
  await fs.writeFile(path.join(dir,'gemma-plugins.mjs'),`import fs from 'node:fs/promises';
   export const managePlugins=async()=>({});
   export const serviceStatus=async()=>null;
   export const enableService=async()=>({ok:true});
   export async function pluginTools(query,call){
    if(!call)return [{name:'gmail.get_profile',description:'내 메일 계정 조회',annotations:{readOnlyHint:true}}];
    if(call.name==='gmail.get_profile')return JSON.stringify({emailAddress:'self@example.com'});
    if(call.name==='gmail.send_email'){await fs.appendFile(process.env.MAIL_LOG,JSON.stringify(call.args)+'\\n');return JSON.stringify({id:'sent-1'});}
    throw Error('Unexpected service operation');
   }`);
  await fs.writeFile(path.join(dir,'model.mjs'),`const ops=JSON.parse(process.env.OPS);
   globalThis.fetch=async(url,opts)=>{
    if(String(url).endsWith('/api/tags'))return Response.json({models:[{name:'gemma4:26b',size:1e9}]});
    if(String(url).endsWith('/api/show'))return Response.json({details:{}});
    const p=JSON.parse(opts.body),f=p.format?.properties;let result;
    if(f?.tool)result=ops.shift()||{tool:'reply',text:'확인했습니다.',path:'',thought:''};
    else if(f?.covered)result={covered:true};
    else if(f?.allow)result={allow:true,reason:'test fixture'};
    else throw Error('Unexpected model request');
    return Response.json({message:{content:JSON.stringify(result)}});
   };`);
  const action=(tool,path='',args={})=>({tool,path,text:tool==='plugin_search'?'gmail':JSON.stringify(args),thought:'검증'});
  for(const scenario of ['send','deny','invalid','changed']){
   const id=randomUUID(),log=path.join(dir,id+'.log');
   const args={to:'me',subject:'테스트 이메일',body:'테스트 메일입니다.',files:[]};
   if(scenario==='invalid')delete args.to;
   const send=action('plugin_call','gmail.send_attached_email',args);
   const ops=[action('plugin_search'),action('plugin_call','gmail.get_profile'),send,scenario==='changed'?action('plugin_call','gmail.send_attached_email',{...args,to:'other@example.com'}):send];
   const child=spawn(process.execPath,['--import','./model.mjs','agent.mjs','--rpc','--project',dir],{cwd:dir,windowsHide:true,env:{...process.env,LOCALAPPDATA:dir,OPS:JSON.stringify(ops),MAIL_LOG:log,LOCAL_GEMMA_MEMORY_SAMPLE:JSON.stringify({recordedAt:Date.now(),available:24,hostReady:true,resident:[]})}});
   const done=once(child,'close');const cards=[];let diagnostics='';child.stdout.on('data',data=>diagnostics+=data);
   child.stdin.end(JSON.stringify({method:'ask',id,text:'Gmail로 나에게 테스트 이메일 보내줘'}));
   for await(const line of createInterface({input:child.stderr})){diagnostics+=line+'\n';if(line.startsWith('@ask ')){
    const card=JSON.parse(line.slice(5));cards.push(card);
    await fs.appendFile(path.join(dir,'대화기록','inbox',id+'.jsonl'),JSON.stringify({askId:card.askId,answer:scenario==='deny'?'거부':'승인'})+'\n');
   }
   }
   await done;
   assert.equal(cards.length,scenario==='invalid'?0:scenario==='changed'?2:1,scenario+' '+diagnostics);
   for(const card of cards){assert.match(card.question,/받는 사람:/);assert.match(card.question,/첨부 파일: 없음/);assert.doesNotMatch(card.question,/send_attached_email|files|write|to ·/);}
   const sent=(await fs.readFile(log,'utf8').catch(()=>'' )).trim().split('\n').filter(Boolean).map(JSON.parse);
   assert.equal(sent.length,['invalid','deny'].includes(scenario)?0:scenario==='changed'?2:1,scenario);
   for(const message of sent){assert.equal(message.payload.mime_type,'text/plain');assert.equal(message.payload.body.content,'테스트 메일입니다.');}
  }
 }finally{await fs.rm(dir,{recursive:true,force:true,maxRetries:5});}
});
