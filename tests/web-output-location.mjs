import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {PNG} from '../라이브러리/pngjs/lib/png.js';
import {runSimpleLoop} from '../simple-loop.mjs';
import {runAgentLoop} from '../agent-loop.mjs';

const write=content=>({tool_calls:[{function:{name:'write',arguments:{path:'index.html',content}}}]});
async function setup(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'web-location-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));await fs.writeFile(path.join(root,'index.html'),'ORIGINAL');return root;}
const frame={width:4,height:4,overflow:0,brokenImages:0,image:PNG.sync.write(new PNG({width:4,height:4})).toString('base64'),elements:[]};
const capture=async file=>({file,frames:[frame,frame]});
const verdict={content:JSON.stringify({visualPass:true,regressed:false,issues:[],summary:'검증'})};

test('new web creation asks first and writes a new project under the selected folder',async t=>{
 const root=await setup(t),selected=path.join(root,'chosen');await fs.mkdir(selected);let questions=0,turn=0;const written=[];
 const result=await runSimpleLoop({input:'구글 검색창 웹페이지 만들어줘',context:{root,askUser:async card=>{assert.equal(written.length,0);assert.match(card.question,/어디|폴더/);questions++;return selected;}},visualCapture:capture,
  chatMessage:async({format})=>format?verdict:[write('NEW'),{content:'완료했습니다.'}][turn++],
  execute:async a=>{const file=path.resolve(root,a.path);written.push(file);await fs.writeFile(file,a.text);return file;}});
 assert.equal(questions,1);assert.equal(result.complete,true);assert.equal(await fs.readFile(path.join(root,'index.html'),'utf8'),'ORIGINAL');
 assert.equal(path.relative(selected,written[0]).startsWith('..'),false);assert.notEqual(written[0],path.join(selected,'index.html'));
});

test('without a destination answer the loop neither writes nor declares completion',async t=>{
 const root=await setup(t);let writes=0;
 const result=await runSimpleLoop({input:'웹페이지 만들어줘',context:{root},visualCapture:capture,chatMessage:async()=>write('NEW'),execute:async()=>{writes++;return 'saved';},maxSteps:3});
 assert.equal(writes,0);assert.equal(result.complete,false);assert.equal(result.needsInput,true);assert.match(result.answer,/어디|폴더/);
});

test('cancelling the location question leaves existing files untouched',async t=>{
 const root=await setup(t);let writes=0;
 const result=await runSimpleLoop({input:'웹페이지 만들어줘',context:{root,askUser:async()=> '작업 중지'},visualCapture:capture,chatMessage:async()=>write('NEW'),execute:async()=>{writes++;},maxSteps:3});
 assert.equal(writes,0);assert.equal(result.complete,false);assert.equal(await fs.readFile(path.join(root,'index.html'),'utf8'),'ORIGINAL');
});

test('file transfer cannot drift into an unrelated image generation service',async()=>{
 let step=0;const executed=[];
 const actions=[{tool:'find_free_tool',text:'image-generation'},{tool:'generate_image',text:'desktop computer',path:'move.png'},{tool:'reply',text:'이동할 파일을 확인하지 못했습니다.'}];
 await runAgentLoop({input:'index.html과 style.css를 바탕화면 새 폴더로 이동해줘',context:{},settings:{noSpec:true,computerUse:false,toolAllow:['find_free_tool','generate_image']},maxSteps:5,
  chat:async()=>JSON.stringify(actions[step++]||actions[2]),execute:async a=>{executed.push(a.tool);return 'unexpected';}});
 assert.deepEqual(executed,[]);
});

test('normal execution mode asks for a new destination and reads back the new file',async t=>{
 const root=await setup(t);let questions=0,step=0;const written=[];
 const script=[{tool:'write',path:'index.html',text:'<!doctype html><html><body>NEW</body></html>'},{tool:'read',path:'index.html',text:''},{tool:'reply',text:'새 파일을 저장했습니다.'}];
 const result=await runAgentLoop({input:'검색창 웹페이지 제작',context:{root,askUser:async()=>{questions++;return root;}},settings:{noSpec:true,computerUse:false,toolAllow:['write','read']},maxSteps:10,visualCapture:capture,
  chat:async(messages,format)=>{if(format.properties.visualPass)return verdict.content;if(format.properties.allow)return JSON.stringify({allow:true,reason:'요청한 새 파일'});if(format.properties.verified)return JSON.stringify({verified:true,quote:'NEW',gap:''});return JSON.stringify(script[step++]||script[2]);},
  execute:async a=>{if(a.tool==='write'){written.push(a.path);await fs.writeFile(a.path,a.text);}return fs.readFile(a.path,'utf8');}});
 assert.equal(questions,1);assert.equal(result.complete,true,result.answer);assert.equal(await fs.readFile(path.join(root,'index.html'),'utf8'),'ORIGINAL');assert.equal(written.length,1);
 assert.ok(result.events.filter(e=>e.tool==='write'||e.tool==='read').every(e=>e.path===written[0]));
});

test('a follow-up creation request still asks when the first HTML write reveals the artifact',async t=>{
 const root=await setup(t);let questions=0,step=0;
 const result=await runSimpleLoop({input:'그거 만들어줘',context:{root,askUser:async()=>{questions++;return root;}},visualCapture:capture,
  chatMessage:async({format})=>format?verdict:[write('NEW'),{content:'저장했습니다.'}][step++],execute:async a=>{await fs.writeFile(path.resolve(root,a.path),a.text);return a.path;}});
 assert.equal(questions,1);assert.equal(result.complete,true);assert.equal(await fs.readFile(path.join(root,'index.html'),'utf8'),'ORIGINAL');
});
