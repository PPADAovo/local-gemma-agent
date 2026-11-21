import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {runSimpleLoop} from '../simple-loop.mjs';
import {runAgentLoop} from '../agent-loop.mjs';
import {createWebQualityGate} from '../web-quality.mjs';
import {PNG} from '../라이브러리/pngjs/lib/png.js';

const frame=()=>({image:PNG.sync.write(new PNG({width:4,height:4})).toString('base64'),width:4,height:4,overflow:0,brokenImages:0,elements:[]});
const call=(content)=>({tool_calls:[{function:{name:'write',arguments:{path:'index.html',content}}}]});
async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'web-quality-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));await fs.writeFile(path.join(root,'index.html'),'original');return root;}

test('simple loop repairs a rejected browser result before claiming completion',async t=>{
 const root=await fixture(t);let turn=0,audits=0,captures=0;const hints=[];
 const result=await runSimpleLoop({input:'웹페이지 디자인 수정',context:{root},maxSteps:8,
  visualCapture:async file=>{captures++;return {file,frames:[frame(),frame()]};},
  execute:async a=>{await fs.writeFile(path.join(root,a.path),a.text);return 'saved';},
  chatMessage:async ({messages,format})=>{
   if(format?.properties?.visualPass){audits++;return {content:JSON.stringify({visualPass:audits>1,regressed:audits===1,issues:audits===1?['검색 아이콘이 너무 큽니다. 크기를 줄이세요.']:[],summary:'화면 비교'})};}
   hints.push(messages.at(-1).content);return [call('broken'),{content:'완료했습니다.'},call('fixed'),{content:'완료했습니다.'}][turn++];
  }});
 assert.equal(audits,4);assert.equal(captures,3,'baseline plus each final render');
 assert.ok(hints.some(s=>s.includes('검색 아이콘')));assert.equal(result.complete,true);
 assert.equal(await fs.readFile(path.join(root,'index.html'),'utf8'),'fixed');
});

test('a missing browser capture cannot be reported as complete',async t=>{
 const root=await fixture(t);let turn=0;
 const result=await runSimpleLoop({input:'웹페이지 수정',context:{root},maxSteps:5,visualCapture:async()=>{throw Error('browser unavailable');},execute:async()=> 'saved',chatMessage:async()=>turn++===0?call('new'):{content:'완료했습니다.'}});
 assert.equal(result.complete,false);assert.match(result.answer,/화면|브라우저/);assert.doesNotMatch(result.answer,/완료했습니다/);
});

test('normal loop also returns visual defects to the worker and rechecks the repair',async t=>{
 const root=await fixture(t);let turn=0,audits=0,captures=0;
 const action=(tool,text='')=>({tool,text,path:tool==='write'||tool==='read'?'index.html':'',thought:'작업'});
 const script=[action('write','broken'),action('read'),action('reply','저장했습니다.'),action('write','fixed'),action('read'),action('reply','저장했습니다.')];
 const result=await runAgentLoop({input:'웹페이지 디자인 수정',context:{root},settings:{computerUse:false,noSpec:true,toolAllow:['write','read']},maxSteps:15,
  visualCapture:async file=>{captures++;return {file,frames:[frame(),frame()]};},
  execute:async a=>{if(a.tool==='write')await fs.writeFile(path.join(root,a.path),a.text);return 'saved';},
  chat:async(messages,format)=>{
   if(format.properties.allow)return JSON.stringify({allow:true,reason:'사용자가 지정한 웹페이지'});
   if(format.properties.visualPass){audits++;return JSON.stringify({visualPass:audits>1,regressed:audits===1,issues:audits===1?['아이콘을 줄이세요']:[],summary:'검사'});}
   if(format.properties.verified)return JSON.stringify({verified:true,quote:'saved',gap:''});
   return JSON.stringify(script[turn++]||action('reply','저장했습니다.'));
  }});
 assert.equal(audits,4);assert.equal(captures,3);assert.equal(result.complete,true,result.answer);
});

for(const mode of ['overflow','regression','malformed','missing','wrong-target'])test('quality gate fails closed for '+mode,async t=>{
 const root=await fixture(t);let captures=0;
 const gate=createWebQualityGate({root,request:'웹페이지 수정',capture:async file=>{
  captures++;if(mode==='missing'&&captures>1)throw Error('capture failed');
  const frames=[frame(),frame()];if(mode==='overflow'&&captures>1)frames[1].overflow=250;
  return {file:mode==='wrong-target'?path.join(root,'other.html'):file,frames};
 },audit:async()=>mode==='malformed'?'not JSON':JSON.stringify({visualPass:true,regressed:mode==='regression',issues:[],summary:'검사'})});
 await gate.before({tool:'write',path:'index.html'});
 assert.ok((await gate.check()).gap);assert.equal(gate.pending,true);
});

test('later CSS edits invalidate a pass and keep the original baseline',async t=>{
 const root=await fixture(t);let captures=0;const orders=[];
 const gate=createWebQualityGate({root,request:'웹페이지 수정',capture:async file=>{captures++;return {file,frames:[frame(),frame()]};},audit:async msgs=>{
  orders.push(JSON.parse(msgs.at(-1).content).order);assert.equal(msgs.at(-1).images.length,1);
  const pixels=PNG.sync.read(Buffer.from(msgs.at(-1).images[0],'base64'));assert.ok(pixels.height>16,'comparison must include separate labelled panels');
  return JSON.stringify({visualPass:true,regressed:false,issues:[],summary:'검사'});
 }});
 await gate.before({tool:'write',path:'index.html'});assert.equal((await gate.check()).gap,'');assert.equal(gate.pending,false);
 await gate.before({tool:'write',path:'style.css'});assert.equal(gate.pending,true);assert.equal((await gate.check()).gap,'');
 assert.equal(captures,3);assert.ok(orders.every(s=>s.includes('수정 전')));
});

test('new HTML gets final browser verification without a fictitious baseline',async t=>{
 const root=await fixture(t);let captures=0;
 const gate=createWebQualityGate({root,capture:async file=>{captures++;return {file,frames:[frame(),frame()]};},audit:async()=>JSON.stringify({visualPass:true,regressed:false,issues:[],summary:'검사'})});
 await gate.before({tool:'write',path:'new.html'});await fs.writeFile(path.join(root,'new.html'),'new');
 assert.equal((await gate.check()).gap,'');assert.equal(captures,1,'only the new page should be checked');
});

test('a later failed recheck revokes the earlier passing receipt',async t=>{
 const root=await fixture(t);let calls=0;
 const gate=createWebQualityGate({root,capture:async file=>({file,frames:[frame(),frame()]}),audit:async()=>JSON.stringify({visualPass:++calls<=2,regressed:false,issues:calls<=2?[]:['잘림'],summary:'검사'})});
 await gate.before({tool:'write',path:'index.html'});assert.equal((await gate.check()).gap,'');
 assert.ok((await gate.check()).gap);assert.equal(gate.pending,true);
});

test('moving or listing HTML files never launches visual design validation',async t=>{
 const root=await fixture(t);let captures=0;
 const gate=createWebQualityGate({root,request:'index.html과 style.css를 새 폴더로 이동',capture:async()=>{captures++;throw Error('must not render');},audit:async()=>{throw Error('must not audit');}});
 for(const action of [{tool:'read',path:'index.html'},{tool:'run',text:'Get-ChildItem -Path "'+root+'"'},{tool:'run',text:'Move-Item -LiteralPath "'+path.join(root,'index.html')+'" -Destination "'+path.join(root,'new')+'"'},{tool:'rename',path:'index.html',text:'new.html'},{tool:'write',path:'copy.html',text:'original'}])await gate.before(action);
 assert.equal(captures,0);assert.equal((await gate.check()).required,false);
});

test('editing one HTML does not audit unrelated sibling HTML pages',async t=>{
 const root=await fixture(t);await fs.writeFile(path.join(root,'unrelated.html'),'old');const captured=[];
 const gate=createWebQualityGate({root,request:'index.html 수정',capture:async file=>{captured.push(path.basename(file));return {file,frames:[frame(),frame()]};},audit:async()=>JSON.stringify({visualPass:true,regressed:false,issues:[],summary:'검사'})});
 await gate.before({tool:'read',path:'unrelated.html'});await gate.before({tool:'write',path:'index.html'});await gate.check();
 assert.deepEqual(captured,['index.html','index.html']);
});
test('completion bookkeeping reuses a passed visual review until another edit',async t=>{
 const root=await fixture(t);let audits=0,captures=0;
 const gate=createWebQualityGate({root,request:'웹페이지 수정',capture:async file=>{captures++;return {file,frames:[frame(),frame()]};},audit:async()=>{audits++;return JSON.stringify({visualPass:true,regressed:false,issues:[],summary:'검사'});}});
 await gate.before({tool:'write',path:'index.html'});
 await gate.check({reuse:true});await gate.check({reuse:true});
 assert.equal(audits,2);assert.equal(captures,2);
 await gate.before({tool:'edit',path:'style.css'});await gate.check({reuse:true});
 assert.equal(audits,4);assert.equal(captures,3);
});
