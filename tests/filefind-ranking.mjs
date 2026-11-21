import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {findFiles,describe,parseQuery} from '../filefind.mjs';
import {runAgentLoop} from '../agent-loop.mjs';

async function tree(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'ff-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const proj=path.join(root,'블랙홀','치이카와-캘린더-풀린');await fs.mkdir(proj,{recursive:true});
  for(const f of ['Calendar.ps1','Launcher.cs','README.txt'])await fs.writeFile(path.join(proj,f),'x');
  await fs.writeFile(path.join(root,'블랙홀','치이카와-캘린더-오늘칸-투명.zip'),'x');
  const ws=path.join(root,'작업공간');await fs.mkdir(ws);
  const toy=path.join(ws,'치이카와달력.html');await fs.writeFile(toy,'<html>');
  await fs.writeFile(path.join(ws,'MEMORY.md'),'x');await fs.writeFile(path.join(ws,'발표 자료.pptx'),'x');await fs.writeFile(path.join(ws,'점수표.xlsx'),'x');
  return {root,proj,toy,ws};
}

test('the project folder outranks the archive and an old agent-made toy file',async t=>{
  const {root,proj,toy}=await tree(t);
  const found=await findFiles('치이카와 캘린더',[root],{folders:true,agentMade:new Set([toy.toLowerCase()])});
  assert.equal(found[0].full,proj);
  const text=describe(found);
  assert.match(text,/안에 파일 3개/);
  assert.match(text,/에이전트가 예전에 만든 파일/);
});

test('달력 and 캘린더 mean the same thing',async t=>{
  const {root,proj}=await tree(t);
  const found=await findFiles('치이카와 달력',[root],{folders:true});
  assert.ok(found.some(r=>r.full===proj));
});

test('an exact file name comes first and is not widened by synonyms',async t=>{
  const {root,toy}=await tree(t);
  assert.equal((await findFiles('치이카와달력.html',[root],{folders:true}))[0].full,toy);
  const memo=await findFiles('메모.txt',[root],{folders:true});
  assert.ok(!memo.some(r=>/MEMORY/.test(r.full)),describe(memo));
});

test('"발표" is not read as a table (Excel) request',()=>{
  const {exts}=parseQuery('발표 ppt');
  assert.ok(exts.includes('.pptx'));
  assert.ok(!exts.includes('.xlsx'),exts.join(','));
});

test('a question that lists candidate files goes to the user instead of being auto-picked',async()=>{
  let asked=null;const executed=[];
  await runAgentLoop({input:'열어봐',recent:[],settings:{noSpec:true,toolAllow:['open_file','reply']},maxSteps:3,
    context:{askUser:async q=>{asked=q;return '작업 중지';}},
    chat:async(m,f)=>{
      if(f?.properties?.tool?.enum?.includes('ask_user'))return JSON.stringify({tool:'open_file',path:'치이카와달력.html',text:'',thought:''});
      return JSON.stringify({tool:'reply',text:'관련된 파일이 여러 개 있습니다. 어떤 것을 열어드릴까요?\n\n1. 치이카와달력.html\n2. 치이카와-캘린더-풀린 (폴더)\n\n원하시는 번호를 말씀해 주세요.',path:'',thought:'',needsInput:true});},
    execute:async a=>{executed.push(a.tool);return 'ok';}});
  assert.ok(asked,'user was not asked');
  assert.deepEqual(asked.options.slice(0,2),['치이카와달력.html','치이카와-캘린더-풀린 (폴더)']);
  assert.ok(!executed.includes('open_file'),executed.join(','));
});
