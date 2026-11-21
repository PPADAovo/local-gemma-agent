import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {captureWebVisual,createWebQualityGate,comparisonImage} from '../web-quality.mjs';
import {closeBrowser} from '../browser.mjs';

test('real Chrome captures both viewports and rejects broken CSS even when the reviewer says pass',{skip:process.env.RUN_BROWSER_QUALITY!=='1'},async()=>{
 const parent=fileURLToPath(new URL('../복구기록/browser-quality-20261115/',import.meta.url));
 const directory=await fs.mkdtemp(path.join(parent,process.env.RUN_VISUAL_MODEL?'model-live-':'browser-live-'));const file=path.join(directory,'index.html');
 await fs.writeFile(path.join(parent,process.env.RUN_VISUAL_MODEL?'latest-model-run.txt':'latest-browser-run.txt'),directory);
 const good='<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>*{box-sizing:border-box}body{font:18px Arial;margin:0;padding:30px}main{max-width:600px;margin:auto}.search{display:flex;border:1px solid #aaa;border-radius:25px;padding:12px;gap:12px}input{flex:1;min-width:0;border:0}svg{width:20px;height:20px;flex-shrink:0}</style><main><h1>Browser quality check</h1><div class="search"><svg viewBox="0 0 24 24"><circle cx="10" cy="10" r="7" fill="none" stroke="gray" stroke-width="2"/><path d="M15 15L22 22" stroke="gray" stroke-width="2"/></svg><input placeholder="Search"><button>Go</button></div></main>';
 await fs.writeFile(file,good);let calls=0;const snapshots=[];
 const verdicts=[];
 const gate=createWebQualityGate({root:directory,request:'검색창 돋보기 아이콘을 20×20px로 표시하고 입력칸과 Go 버튼이 데스크톱과 모바일에서 잘림 없이 보이게 수정해 주세요. 기존의 나머지 구성은 유지하세요.',capture:async target=>{const capture=await captureWebVisual(target);snapshots.push(capture);return capture;},audit:async(messages,format)=>{
  calls++;
  if(process.env.RUN_VISUAL_MODEL){
   const response=await fetch('http://127.0.0.1:11434/api/chat',{method:'POST',signal:AbortSignal.timeout(180000),headers:{'Content-Type':'application/json'},body:JSON.stringify({model:process.env.RUN_VISUAL_MODEL,messages,format,stream:false,think:false,options:{temperature:0,num_ctx:16384,num_predict:1500}})});
   if(!response.ok)throw Error('Local visual model HTTP '+response.status);
   const value=(await response.json()).message.content;verdicts.push(JSON.parse(value));await fs.writeFile(path.join(directory,'model-verdicts.json'),JSON.stringify(verdicts,null,2));return value;
  }
  return JSON.stringify({visualPass:true,regressed:false,issues:[],summary:'검사'});
 }});
 try{
  await gate.before({tool:'write',path:'index.html'});
  await fs.writeFile(file,good+'<style>svg{width:900px;height:220px}</style>');
  const rejected=await gate.check();assert.match(rejected.gap,/넘침|SVG/);
  await fs.writeFile(path.join(directory,'before-after.png'),Buffer.from(await comparisonImage(snapshots[0],snapshots[1]),'base64'));
  await gate.before({tool:'write',path:'index.html'});await fs.writeFile(file,good);
  const accepted=await gate.check();assert.equal(accepted.gap,'');assert.equal(calls,4);assert.equal(snapshots.length,3);
  assert.deepEqual(snapshots[0].frames.map(f=>f.width),[1280,390]);
  await fs.writeFile(path.join(directory,'result.json'),JSON.stringify({rejected:rejected.gap,accepted:accepted.gap,captures:snapshots.length,viewports:[1280,390]},null,2));
 }finally{await closeBrowser();}
});
