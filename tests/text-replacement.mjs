import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {schemaFor,runAgentLoop} from '../agent-loop.mjs';
import {SIMPLE_TOOLS,toAction} from '../simple-loop.mjs';

test('native and legacy schemas expose explicit replacement without changing default insertion',()=>{
  assert.equal(SIMPLE_TOOLS.find(t=>t.function.name==='type').function.parameters.properties.replace?.type,'boolean');
  assert.equal(schemaFor(['type']).properties.replace?.type,'boolean');
  assert.equal(toAction('type',{text:'name',replace:true}).replace,true);
  assert.notEqual(toAction('type',{text:'name'}).replace,true);
});

test('production native adapter forwards replacement only when explicitly true',async()=>{
  const source=await fs.readFile(new URL('../agent.mjs',import.meta.url),'utf8');
  const statement=source.split(/\r?\n/).find(line=>line.trim().startsWith("return computer({action:'type',text:String(action.text"));
  assert.ok(statement);
  const invoke=new Function('action','desktopFrame','computer',statement);
  const requests=[];
  await invoke({text:'new',replace:true,observedHandle:7},null,request=>requests.push(request));
  await invoke({text:'append',observedHandle:7},null,request=>requests.push(request));
  assert.equal(requests[0].replace,true);
  assert.notEqual(requests[1].replace,true);
});

test('legacy replacement keeps its observed input target and click coordinates',async()=>{
  let typed;const frame={image:'fixture',imageWidth:600,imageHeight:400,left:0,top:0,width:600,height:400,window:{handle:7,pid:12,title:'테스트',process:'fixture',rect:[0,0,600,400]},elements:[{id:1,type:'Edit',name:'이름',x:300,y:200}],texts:['새이름']};
  await runAgentLoop({input:'이름 입력칸을 새이름으로 바꿔줘',settings:{noSpec:true,computerUse:true,toolAllow:['look','type']},context:{selectedWindow:true},maxSteps:5,
    chat:async(_messages,format)=>{
      if(format?.properties?.verified)return JSON.stringify({verified:true,quote:'새이름',gap:''});
      return JSON.stringify(typed?{tool:'reply',text:'새이름으로 입력했습니다.',thought:'확인'}:{tool:'type',text:'새이름',target:'E1',replace:true,thought:'기존 이름 전체 교체'});
    },execute:async action=>{if(action.tool==='look')return frame;typed=action;return {ok:true};}});
  assert.equal(typed.replace,true);assert.equal(typed.observedHandle,7);
  assert.equal(typed.absX,300);assert.equal(typed.absY,200);
});

test('native replacement validates focus and preserves ordinary insertion',{skip:process.platform!=='win32'},()=>{
  const output=execFileSync('powershell.exe',['-NoProfile','-STA','-ExecutionPolicy','Bypass','-File',fileURLToPath(new URL('./text-replacement.ps1',import.meta.url))],{windowsHide:true,encoding:'utf8'});
  assert.match(output,/replacement guard and input scenarios passed/);
});
