import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {parseSheetSpec,verifyRequestedPrecision,makeXlsx} from '../xlsx.mjs';
import {makePptx} from '../pptx.mjs';
import {calc} from '../calc.mjs';
import {runAgentLoop} from '../agent-loop.mjs';

const run=promisify(execFile);
const reader=fileURLToPath(new URL('../read-office.ps1',import.meta.url));
async function temp(t){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gemma-review-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  return dir;
}
async function read(file){
  return (await run('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',reader,file],{windowsHide:true})).stdout;
}
test('100 decimal places survive a numeric JSON token, workbook write and Office readback',async t=>{
  const dir=await temp(t);
  const pi=calc('pi 100').split('\n')[0];
  const spec=parseSheetSpec('{"rows":[['+pi+',42]]}');
  assert.equal(spec.rows[0][0],pi);assert.equal(spec.rows[0][1],42);
  await verifyRequestedPrecision(spec,'원주율 소수점 100자리');
  await assert.rejects(verifyRequestedPrecision({rows:[[Math.PI]]},'원주율 100자리'));
  const file=path.join(dir,'table.xlsx');await makeXlsx(spec,file);
  assert.ok((await read(file)).includes('A1 '+pi));
});
test('slide text is readable from the saved presentation',async t=>{
  const file=path.join(await temp(t),'slide.pptx');
  await makePptx({slides:[{title:'검수용 제목',bullets:['내용 대조']}]},file);
  assert.ok((await read(file)).includes('검수용 제목'));
});
test('reply without a tool result cannot replay file or undo cards',async()=>{
  const result=await runAgentLoop({input:'안녕',recent:[],context:{},settings:{noSpec:true,computerUse:false},
    chat:async()=>JSON.stringify({tool:'reply',text:'안녕\n결과 파일:\n📄 old.xlsx | - | created\n↩ old.json'}),
    execute:async()=>{throw Error('unexpected');},maxSteps:2});
  assert.doesNotMatch(result.answer,/old\.|결과 파일:/);
});
test('Gemini API helper preserves the complete multiline prompt',async t=>{
  const dir=await temp(t);
  await fs.copyFile(new URL('../gemini.mjs',import.meta.url),path.join(dir,'gemini.mjs'));
  await fs.writeFile(path.join(dir,'cloud-brain.mjs'),"export function extractJson(s){return JSON.parse(s)};export async function selectedBrain(){return {status:async()=>({ok:true})}};export async function chat(messages){return {text:messages[0].content}};");
  const {ask}=await import(pathToFileURL(path.join(dir,'gemini.mjs')));
  const prompt=('검수용 자료 123\n').repeat(7000)+'끝';
  assert.equal((await ask(prompt)).text,prompt);
});
