import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createInterface} from 'node:readline';
import {fileURLToPath} from 'node:url';
function fixture(){
 const original=globalThis.fetch;let acted=false;const drag=process.env.TEST_DESKTOP_DRAG;
 globalThis.fetch=async(url,options)=>{
  const cloud=String(url)==='https://fixture.invalid/chat';
  if(!cloud&&!String(url).startsWith('http://127.0.0.1:11434/'))return original(url,options);
  if(!cloud&&process.env.TEST_DESKTOP_BRAIN!=='local'){
   // Auto-title may probe running models; an unavailable local service is fine.
   // Desktop reasoning must not request model discovery or inference from it.
   if(new URL(url).pathname!=='/api/ps')await (await import('node:fs/promises')).appendFile(process.env.TEST_DESKTOP_CALLS,'local-model\n');
   throw Error('cloud-only test has no local model');
  }
  const endpoint=cloud?'/api/chat':new URL(url).pathname;
  if(endpoint==='/api/tags')return Response.json({models:[{name:'qwen3.5:9b',size:6e9}]});
  if(endpoint==='/api/show')return Response.json({details:{}});
  if(endpoint!='/api/chat')throw Error('unexpected '+endpoint);
  const p=JSON.parse(options.body),f=p.format?.properties;let answer;
  if(f?.located)answer={located:true,selectedMatches:true,x:200,y:200,label:'친구'};
  else if(f?.work)answer={work:'친구 탭 열기',target:'카카오톡',effect:'친구 목록 표시'};
  else if(f?.effect){
   if(drag){const input=JSON.parse(p.messages.at(-1).content).input;if(input.action!=='drag'||input.path?.length!==2||!input.path.every(q=>q.x>=0&&q.x<1000&&q.y>=0&&q.y<1000))throw Error('missing normalized drag path');}
   answer={effect:process.env.TEST_UNKNOWN_TARGET==='1'?'unknown':drag?'local_edit':'navigation',inScope:process.env.TEST_UNKNOWN_TARGET!=='1',targetConfirmed:process.env.TEST_UNKNOWN_TARGET!=='1',reason:'대상 확인 결과'};
  }
  else if(f?.covered)answer={covered:true};
  else if(f?.verified)answer={verified:true,quote:'친구 목록',gap:''};
  else if(f?.tool){
   const text=p.messages.map(m=>m.content).join('\n');
   if(!text.includes('Screenshot of the current screen'))answer={tool:'focus',text:'카카오톡',thought:'창 활성화'};
   else if(!acted){acted=true;answer=drag?{tool:'drag',text:drag==='strokes'?'canvas:first=10,10;30,30|second=50,50;80,80':'20,20;80,80',thought:'선택 영역 드래그'}:{tool:'click',text:'E1',thought:'친구 탭 열기'};}
   else answer={tool:'reply',text:'친구 목록을 확인했습니다.'};
  }else throw Error('unexpected schema '+JSON.stringify(f));
  return Response.json({done:true,message:{content:JSON.stringify(answer)}});
 };
}
for(const [unknown,drag,brain,permission='auto',daemon=false] of [[false,'','local'],[true,'','local'],[false,'single','local'],[false,'strokes','local'],[false,'','api-gemini'],[false,'','sub-gemini'],[false,'','api-gemini','confirm'],[false,'','local','auto',true],[false,'strokes','local','auto',true],[false,'','api-gemini','confirm',true]])test('real RPC grounds desktop input with selected approval mode (unknown='+unknown+', drag='+drag+', brain='+brain+', permission='+permission+(daemon?', resident executor':'')+')',{skip:process.platform!=='win32',timeout:60000},async t=>{
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'desktop-auto-rpc-'));t.after(()=>fs.rm(temp,{recursive:true,force:true,maxRetries:4}));
 const app=path.join(temp,'app');await fs.mkdir(app);const source=fileURLToPath(new URL('../',import.meta.url));
 for(const f of await fs.readdir(source))if(/\.(mjs|ps1)$/.test(f))await fs.copyFile(path.join(source,f),path.join(app,f));
 if(process.env.DESKTOP_APPROVAL_BASELINE)await fs.copyFile(process.env.DESKTOP_APPROVAL_BASELINE,path.join(app,'agent.mjs'));
 if(brain!=='local')await fs.writeFile(path.join(app,'cloud-brain.mjs'),`export async function selectedBrain(name){if(name!==process.env.TEST_DESKTOP_BRAIN)throw Error('wrong brain');return {status:async()=>({ok:true}),complete:async(messages,format)=>{const response=await fetch('https://fixture.invalid/chat',{body:JSON.stringify({messages,format})});return (await response.json()).message.content;}};}`);
 const oneCall=String.raw`function One([string]$Payload){
$r=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Payload))|ConvertFrom-Json
$r.action | Add-Content -LiteralPath $env:TEST_DESKTOP_CALLS
$w=@{handle=7;pid=12;process='KakaoTalk';title='카카오톡';rect=@(0,0,100,100)}
if($r.action -eq 'windows'){@{windows=@($w);foreground=$w}|ConvertTo-Json -Depth 8 -Compress;return}
if($r.action -eq 'look'){@{window=$w;left=0;top=0;width=100;height=100;imageWidth=100;imageHeight=100;image='aW1hZ2U=';canvas=@{left=0;top=0;width=100;height=100};elements=@(@{id=1;name='친구';type='Button';x=20;y=20});texts=@('친구 목록')}|ConvertTo-Json -Depth 8 -Compress;return}
if($r.action -eq 'drag' -and $r.observedHandle -ne $w.handle){throw 'missing drag observation binding'}
[Console]::Error.WriteLine('@appApproval '+(@{action=$r.action;process='KakaoTalk';handle=7;pid=12}|ConvertTo-Json -Compress))
if([Console]::ReadLine() -ne 'approve'){throw 'denied'}
@{ok=$true;window=$w}|ConvertTo-Json -Depth 8 -Compress
}
`;
 // The resident variant speaks the same line protocol as computer.ps1 -Daemon. The one-shot variant lacks that switch, so the agent falls back to one process per call.
 const entry=daemon?String.raw`param([string]$Payload,[switch]$Daemon)
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
`+oneCall+String.raw`if($Daemon){'daemon-start'|Add-Content -LiteralPath $env:TEST_DESKTOP_CALLS;while($null -ne ($l=[Console]::In.ReadLine())){try{$t=One $l;[Console]::Out.WriteLine('@daemonResult '+[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([string]$t)))}catch{[Console]::Out.WriteLine('@daemonError '+[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($_.Exception.Message)))}}}else{One $Payload}
`:String.raw`param([string]$Payload)
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
`+oneCall+'One $Payload\n';
 await fs.writeFile(path.join(app,'computer.ps1'),'﻿'+entry,'utf8');
 await fs.writeFile(path.join(app,'fixture.mjs'),'('+fixture.toString()+')();');
 const cfg=path.join(temp,'LocalGemmaDesktop');await fs.mkdir(cfg);
 await fs.writeFile(path.join(cfg,'preferences.json'),JSON.stringify({loopMode:'legacy',model:'qwen3.5:9b',brain,localFirst:brain==='local',approval:permission,noSpec:true,showOverlay:false,memoryEnabled:false,toolAllow:['focus','look',drag?'drag':'click']}));
 const inbox=path.join(app,'대화기록','inbox');await fs.mkdir(inbox,{recursive:true});const id=crypto.randomUUID();
 const calls=path.join(temp,'calls.txt');
 const child=spawn(process.execPath,['--import','./fixture.mjs','agent.mjs','--rpc','--project',temp],{cwd:app,windowsHide:true,env:{...process.env,TEST_DESKTOP_BRAIN:brain,TEST_DESKTOP_CALLS:calls,TEST_DESKTOP_DRAG:drag,TEST_UNKNOWN_TARGET:unknown?'1':'0',LOCALAPPDATA:temp,LOCAL_GEMMA_MEMORY_SAMPLE:JSON.stringify({recordedAt:Date.now(),available:20,hostReady:true,resident:[]})}});
 t.after(()=>child.kill());const closed=once(child,'close');let out='',err='',cards=0;
 child.stdout.setEncoding('utf8').on('data',s=>out+=s);child.stdin.end(JSON.stringify({method:'ask',id,text:drag?'카카오톡 화면을 조작해서 선택 영역을 드래그하고 확인해줘':'카카오톡 화면에서 친구 탭을 클릭하고 확인해줘',permission}));
 for await(const line of createInterface({input:child.stderr})){
  if(line.startsWith('@ask ')){cards++;const card=JSON.parse(line.slice(5));await fs.appendFile(path.join(inbox,id+'.jsonl'),JSON.stringify({askId:card.askId,answer:card.options?.includes('승인')?'승인':'허용'})+'\n');}
  else err+=line+'\n';
 }
 const [code]=await closed;assert.equal(code,0,err);if(permission==='auto')assert.equal(cards,0,err);else assert.ok(cards>0,'confirmation mode must ask');
 const result=JSON.parse(out);assert.equal(result.events.some(e=>e.tool===(drag?'drag':'click')&&e.ok),!unknown,out+'\n'+err);if(!unknown)assert.equal(result.complete,true,out);
 if(daemon)assert.equal((await fs.readFile(calls,'utf8')).match(/daemon-start/g)?.length,1,'resident executor must start once and be reused');
 if(brain!=='local')assert.doesNotMatch(await fs.readFile(calls,'utf8'),/local-model/,'cloud-only input must not attempt a local model');
 if(drag==='strokes')assert.match(await fs.readFile(calls,'utf8'),/drag\s+look\s+drag/,'each stroke must use a fresh screenshot');
});

