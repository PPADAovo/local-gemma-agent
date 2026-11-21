import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createInterface} from 'node:readline';
import http from 'node:http';
import {once} from 'node:events';

const source=fileURLToPath(new URL('../',import.meta.url));
function modelFixture(){
 const actual=globalThis.fetch;
 const ops=JSON.parse(process.env.TEST_OPERATIONS);
 globalThis.fetch=async (url,opts)=>{
  if(!String(url).startsWith('http://127.0.0.1:11434/'))return actual(url,opts);
  const route=new URL(url).pathname;
  if(route==='/api/tags')return Response.json({models:[{name:'qwen3.5:9b',size:6e9}]});
  if(route==='/api/show')return Response.json({details:{}});
  if(route!='/api/chat')throw Error('unknown model route '+route);
  const p=JSON.parse(opts.body), f=p.format?.properties, input=p.messages.at(-1).content;
  let answer;
  if(f?.work){
   const action=JSON.parse(input), deleting=action.text.includes('Remove-Item');
   answer={work:deleting?'파일을 삭제합니다.':'검사용 문장을 출력합니다.',target:deleting?'sample.txt':'검사 결과 화면',effect:deleting?'파일이 삭제됩니다.':'검사용 문장이 표시됩니다.'};
  }
  else if(f?.covered)answer={covered:true};
  else if(f?.allow)answer={allow:true,reason:'controlled temporary fixture'};
  else if(f?.verified){const {evidence}=JSON.parse(input);const quote=evidence.at(-1)?.result.slice(0,12);answer={verified:true,quote,gap:''};}
  else if(f?.tool){
   if(!p.messages.some(m=>m.role==='system' && m.content.includes('APPROVAL MODE: '+process.env.TEST_EXPECTED_APPROVAL)))
     throw Error('effective permission mode is missing from the model prompt');
   answer=ops.shift()||{tool:'reply',text:'검사 결과입니다.',path:'',thought:'검사'};
  }else throw Error('unexpected model step');
  return Response.json({done:true,message:{content:JSON.stringify(answer)}});
 };
}

test('native RPC permission modes apply to temporary file mutations, commands, and web access', {timeout:120000},async t=>{
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'gemma-approval-rpc-'));
 t.after(()=>fs.rm(temp,{recursive:true,force:true,maxRetries:4}));
 const app=path.join(temp,'app');await fs.mkdir(app);
 for(const f of await fs.readdir(source))if(/\.(?:mjs|ps1)$/.test(f))await fs.copyFile(path.join(source,f),path.join(app,f));
 // Replace only the external browser boundary; run the actual RPC, plugin registry and approvals.
 await fs.writeFile(path.join(app,'browser.mjs'),`import fs from 'node:fs/promises';
 let kept=false;
 const log=s=>fs.appendFile(process.env.TEST_BROWSER_LOG,s+'\\n');
 export const setBrowserTask=()=>{},latestChannelVideo=()=>{},pauseWorkTab=()=>{},subscriptionTabState=()=>{};
 export const hasWorkTab=async()=>true;
 export async function browser(){await log('opened');return '페이지: Gmail\\n주소: https://mail.google.com/mail/u/0/#inbox';}
 export const readImportantMail=browser;
 export async function leaveWorkTabOpen(){kept=true;await log('kept');}
 export async function closeBrowser(){await log(kept?'released-kept':'released');}
 `);
 const cfg=path.join(temp,'LocalGemmaDesktop');await fs.mkdir(cfg);
 await fs.writeFile(path.join(app,'model-fixture.mjs'),'('+modelFixture.toString()+')();');
 await fs.mkdir(path.join(app,'대화기록','inbox'),{recursive:true});
 let requests=0;
 const server=http.createServer((_req,res)=>{requests++;res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<main>권한 테스트 문서</main>');});
 server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>server.close());
 const url='http://127.0.0.1:'+server.address().port+'/notice';
 const act=(tool,path='',text='',extra={})=>({tool,path,text,thought:'점검',...extra});
 const cases=[
  {name:'create',text:'sample.txt를 생성해줘',ops:[act('write','sample.txt','after'),act('read','sample.txt')],after:'after'},
  {name:'edit',text:'sample.txt를 수정해줘',initial:'before',ops:[act('read','sample.txt'),act('edit','sample.txt','',{old:'before',new:'after'}),act('read','sample.txt')],after:'after'},
  {name:'delete',text:'sample.txt를 삭제해줘',initial:'before',ops:[act('delete','sample.txt')],after:null},
  {name:'command',text:'검사용 명령으로 텍스트를 출력해줘',ops:[act('run','','Write-Output approval-ok')],after:null},
  {name:'command-bundle',text:'검사용 문장 두 개를 차례로 출력해줘',ops:[act('run','','Write-Output first'),act('run','','Write-Output second')],after:null},
  {name:'cleanup',text:'검사 명령으로 임시 파일을 치워줘',initial:'before',ops:[act('run','',"Remove-Item -LiteralPath 'sample.txt'")],after:null},
  {name:'web',text:'연결 시험 페이지를 웹 도구로 확인해줘',ops:[act('web_read',url)],after:null},
  {name:'service-open',text:'지메일 열어줘',ops:[act('plugin_call','local.gmail.open','{}')],after:null},
  {name:'service-read',text:'지메일 중요 메일 확인해줘',ops:[act('plugin_call','local.gmail.important','{}')],after:null}
 ];
 const desktopTest=process.platform==='win32' && process.env.GEMMA_TEST_VISIBLE_PERMISSIONS==='1';
 const fixtureExe=path.join(process.env.SystemRoot||'C:/Windows','System32/WindowsPowerShell/v1.0/powershell.exe');
 if(desktopTest){
  const title='Gemma approval fixture '+crypto.randomUUID();
  const form="$f=New-Object Windows.Forms.Form;$f.Text='"+title+"';$f.Width=220;$f.Height=80;"+
   "$f.Add_Shown({$f.Hide();$f.Show();[Console]::WriteLine('READY')});[void]$f.ShowDialog()";
  const fixture=spawn(fixtureExe,['-NoProfile','-STA','-Command','Add-Type -AssemblyName System.Windows.Forms;'+form],{windowsHide:true});
  t.after(()=>fixture.kill());
  await once(fixture.stdout,'data');
  cases.push({name:'focus',text:'권한 검사 창을 앞으로 가져와줘',ops:[act('focus','',title)],after:null});
 }
 for(const modeSource of ['saved','request']) for(const mode of ['confirm','auto','full']){
  await t.test(modeSource+'/'+mode,async()=>{
   for(const op of cases){
    // 권한 표: 명령 삭제(백업 없음)는 어떤 모드든 묻고, 삭제 도구·원래 있던 파일 수정은 '전체 권한'이 아니면 묻습니다.
    const needsCard=mode==='confirm'||op.name==='cleanup'||mode==='auto'&&['delete','edit'].includes(op.name);
    for(const denied of needsCard?[false,true]:[false]){
     const project=await fs.mkdtemp(path.join(temp,'project-')), file=path.join(project,'sample.txt');
     if(op.initial)await fs.writeFile(file,op.initial);
     const prefs={loopMode:'legacy',model:'qwen3.5:9b',brain:'local',approval:modeSource==='saved'?mode:mode==='full'?'confirm':'full',noSpec:true,webEnabled:true,webMode:'ask',showOverlay:false,memoryEnabled:false,allowedPrograms:desktopTest?[fixtureExe]:[],toolAllow:['read','write','edit','delete','run','web_read','focus']};
     prefs.toolAllow.push('plugin_call');
     await fs.writeFile(path.join(cfg,'preferences.json'),JSON.stringify(prefs));
     const id=crypto.randomUUID(),before=requests;
     const child=spawn(process.execPath,['--import','./model-fixture.mjs','agent.mjs','--rpc','--project',project],{
      cwd:app,windowsHide:true,env:{...process.env,LOCALAPPDATA:temp,TEST_BROWSER_LOG:path.join(project,'browser.log'),TEST_OPERATIONS:JSON.stringify(op.ops),TEST_EXPECTED_APPROVAL:mode,
       LOCAL_GEMMA_MEMORY_SAMPLE:JSON.stringify({recordedAt:Date.now(),available:20,hostReady:true,resident:[]})}});
     const done=once(child,'close');let out='',err='',cards=0;const questions=[];
     child.stdout.setEncoding('utf8').on('data',s=>out+=s);
     child.stdin.end(JSON.stringify({method:'ask',id,text:op.text,...(modeSource==='request'?{permission:mode}:{})}));
     for await(const line of createInterface({input:child.stderr})){
      if(!line.startsWith('@ask ')){err+=line+'\n';continue;}
      const card=JSON.parse(line.slice(5));cards++;questions.push(card.question);
      await fs.appendFile(path.join(app,'대화기록','inbox',id+'.jsonl'),JSON.stringify({askId:card.askId,answer:denied?'거부':'승인'})+'\n');
     }
     const [code]=await done,label=[mode,op.name,denied?'deny':'allow'].join('/');
     assert.equal(code,0,label+' '+err);
     assert.equal(cards,needsCard?1:0,label+' '+err);
     for(const question of questions)assert.doesNotMatch(question,/Remove-Item|Write-Output|browser_click|local\.gmail\.|inputSchema|\bfiles\s*[·:]/,label+' raw implementation in approval');
     if(op.name.startsWith('service-')){
       const lifecycle=await fs.readFile(path.join(project,'browser.log'),'utf8');
       assert.equal(lifecycle,denied?'released\n':op.name==='service-open'?'opened\nkept\nreleased-kept\n':'opened\nreleased\n',label);
     }
     const actual=await fs.readFile(file,'utf8').catch(e=>e.code==='ENOENT'?null:Promise.reject(e));
     assert.equal(actual,denied?op.initial||null:op.after,label);
     if(op.name==='web')assert.equal(requests-before,denied?0:1,label);
     const result=JSON.parse(out);
     if(denied){
       const effect=op.name==='edit'?'edit':op.ops[0].tool;
       assert.equal(result.complete,false,label);
       assert(!result.events.some(e=>e.tool===effect && e.ok),label+' executed after rejection');
     }
     if(!denied)assert(result.events.some(e=>e.tool===op.ops.at(0).tool&&e.ok),label+' '+out.slice(0,450)+' '+err);
    }
   }
  });
 }
});
