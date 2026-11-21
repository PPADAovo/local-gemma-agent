import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import fs from 'node:fs/promises';
import {readFileSync,existsSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
import {acpComplete} from '../gemini-acp.mjs';
import {sessionComplete,utilityComplete} from '../gemini-session.mjs';

function fixture({image=true,stopReason='end_turn',requestTool=false,initialize=true,modelOptions}={}){
  const requests=[],responses=[];let child,workspace,agent;
  const spawnProcess=(exe,args,options)=>{
    workspace=options.cwd;agent=readFileSync(path.join(workspace,'.agents','agents','local-gemma-vision.md'),'utf8');
    assert.equal(args[0],'acp');assert.ok(args.includes('--agent'));assert.ok(args.includes('local-gemma-vision'));
    child=new EventEmitter();Object.assign(child,{stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough(),kill(){this.killed=true;}});
    const emit=message=>queueMicrotask(()=>child.stdout.write(JSON.stringify({jsonrpc:'2.0',...message})+'\n'));
    child.stdin.on('data',data=>{
      for(const line of String(data).trim().split('\n')){
        const message=JSON.parse(line);
        if(!message.method){responses.push(message);continue;}
        requests.push(message);
        if(message.method==='initialize'&&initialize)emit({id:message.id,result:{protocolVersion:1,agentCapabilities:{promptCapabilities:{image}}}});
        if(message.method==='session/new')emit({id:message.id,result:{sessionId:'synthetic-session',...(modelOptions?{configOptions:[modelOptions]}:{})}});
        if(message.method==='session/set_config_option')emit({id:message.id,result:{configOptions:[{...modelOptions,currentValue:message.params.value}]}});
        if(message.method==='session/prompt'){
          if(requestTool){emit({id:99,method:'session/request_permission',params:{sessionId:'synthetic-session',options:[]}});continue;}
          emit({method:'session/update',params:{sessionId:'synthetic-session',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'{"answer":"both images received"}'}}}});
          emit({id:message.id,result:{stopReason}});
        }
      }
    });return child;
  };
  return {spawnProcess,requests,responses,get child(){return child;},get workspace(){return workspace;},get agent(){return agent;}};
}
const schema={type:'object',properties:{answer:{type:'string'}},required:['answer']};
const images=['iVBORw0KGgo=','/9j/fixture','UklGRfixture'];
const messages=[{role:'user',content:'reference pair',keep:true,images:images.slice(0,2)},{role:'user',content:'current screen',images:images.slice(2)}];

test('ACP sends real image content blocks in order using a disposable tool-free agent',async()=>{
  const cli=fixture();
  const reply=await acpComplete(messages,schema,{exe:'fixture',spawnProcess:cli.spawnProcess});
  assert.equal(JSON.parse(reply).answer,'both images received');
  const prompt=cli.requests.find(r=>r.method==='session/prompt').params.prompt;
  assert.deepEqual(prompt.filter(p=>p.type==='image').map(p=>p.data),images);
  assert.deepEqual(prompt.filter(p=>p.type==='image').map(p=>p.mimeType),['image/png','image/jpeg','image/webp']);
  assert.ok(prompt.findIndex(p=>p.text?.includes('reference pair'))<prompt.findIndex(p=>p.data===images[0]));
  assert.ok(prompt.findIndex(p=>p.data===images[1])<prompt.findIndex(p=>p.text?.includes('current screen')));
  assert.match(cli.agent,/tools: \[\]/);assert.match(cli.agent,/commandExecutionPolicy: "off"/);assert.match(cli.agent,/mcpServers: \[\]/);
  assert.deepEqual(cli.requests[0].params.clientCapabilities,{fs:{readTextFile:false,writeTextFile:false},terminal:false});
  assert.equal(cli.child.killed,true);assert.equal(existsSync(cli.workspace),false);
});
test('missing ACP image capability fails explicitly before creating a session or prompting',async()=>{
  const cli=fixture({image:false});
  await assert.rejects(acpComplete(messages,schema,{exe:'fixture',spawnProcess:cli.spawnProcess}),e=>e.code==='VISION_UNSUPPORTED');
  assert.deepEqual(cli.requests.map(r=>r.method),['initialize']);assert.equal(cli.child.killed,true);
});
test('ACP refuses an external permission request and stops the child',async()=>{
  const cli=fixture({requestTool:true});
  await assert.rejects(acpComplete(messages,schema,{exe:'fixture',spawnProcess:cli.spawnProcess}),e=>e.code==='EXTERNAL_TOOL_REQUEST');
  assert.equal(cli.responses[0].result.outcome.outcome,'cancelled');assert.equal(cli.child.killed,true);
});
test('ACP incomplete response is never delivered as a complete JSON answer',async()=>{
  const cli=fixture({stopReason:'max_tokens'});
  await assert.rejects(acpComplete(messages,schema,{exe:'fixture',spawnProcess:cli.spawnProcess}),e=>e.code==='OUTPUT_TRUNCATED');
  assert.equal(cli.child.killed,true);
});
test('ACP cancellation stops initialization and cleans the disposable workspace',async()=>{
  const cli=fixture({initialize:false}),controller=new AbortController();
  const pending=acpComplete(messages,schema,{exe:'fixture',spawnProcess:(...args)=>{const child=cli.spawnProcess(...args);queueMicrotask(()=>controller.abort(Error('cancelled by caller')));return child;},signal:controller.signal});
  await assert.rejects(pending,/cancelled by caller/);assert.equal(cli.child.killed,true);assert.equal(existsSync(cli.workspace),false);
});
test('configured ACP model is selected from advertised config options before any prompt',async()=>{
  const cli=fixture({modelOptions:{id:'session-model',category:'model',type:'select',currentValue:'default',options:[{value:'fixture-model',name:'Fixture model'}]}});
  await acpComplete(messages,schema,{exe:'fixture',model:'fixture-model',spawnProcess:cli.spawnProcess,deadline:Date.now()+2000});
  const selection=cli.requests.find(r=>r.method==='session/set_config_option');
  assert.equal(selection.params.configId,'session-model');assert.equal(selection.params.value,'fixture-model');
  assert.ok(cli.requests.indexOf(selection)<cli.requests.findIndex(r=>r.method==='session/prompt'));
});
test('unavailable configured ACP model is not silently replaced with server default',async()=>{
  const cli=fixture();
  await assert.rejects(acpComplete(messages,schema,{exe:'fixture',model:'missing-model',spawnProcess:cli.spawnProcess,deadline:Date.now()+2000}),error=>error.code==='MODEL_UNAVAILABLE');
  assert.ok(!cli.requests.some(r=>r.method==='session/prompt'));
});
for(const [name,complete] of [['session',sessionComplete],['utility',utilityComplete]])test('headless '+name+' explicitly rejects images before starting a text-only CLI',async()=>{
  await assert.rejects(complete(messages,schema,{exe:'fixture',spawnProcess:()=>assert.fail('text-only process started')}),error=>error.code==='VISION_UNSUPPORTED');
});

test('Gemini account routes any images to ACP even if text sessions are disabled',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gemini-image-route-')),previous=process.env.PATH;
  t.after(async()=>{process.env.PATH=previous;await fs.rm(dir,{recursive:true,force:true});});
  await fs.copyFile(new URL('../gemini-account.mjs',import.meta.url),path.join(dir,'gemini-account.mjs'));
  await fs.writeFile(path.join(dir,'agy.exe'),'fixture');process.env.PATH=dir+path.delimiter+previous;
  await fs.writeFile(path.join(dir,'제미나이설정.json'),JSON.stringify({session:false}));
  await fs.writeFile(path.join(dir,'cloud-brain.mjs'),'export const extractJson=JSON.parse;');
  await fs.writeFile(path.join(dir,'gemini-quota.mjs'),"export const usableModels=()=>[''];export const markExhausted=()=>{};export const isQuotaError=()=>false;export const quotaNote=()=>'';");
  await fs.writeFile(path.join(dir,'model-process-lifecycle.mjs'),'export const watchModelProcess=()=>{};');
  await fs.writeFile(path.join(dir,'gemini-session.mjs'),"export const sessionComplete=()=>{throw Error('TEXT_ROUTE')};export const utilityComplete=sessionComplete;export const materializeImages=sessionComplete;export const imageNote=sessionComplete;");
  await fs.writeFile(path.join(dir,'gemini-acp.mjs'),"export async function acpComplete(messages){return JSON.stringify({images:messages.flatMap(m=>m.images||[])})};");
  const provider=await import(pathToFileURL(path.join(dir,'gemini-account.mjs')));
  assert.deepEqual(JSON.parse(await provider.complete(messages,schema)).images,images);
});
