import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {readAppNotes,saveAppNote,routeFromSteps,looksLikeRouteHint,summarizeRoute} from '../app-notes.mjs';
import {runAgentLoop} from '../agent-loop.mjs';

test('learned notes are saved per app, replaced for the same job, and merged after the shipped ones',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'app-notes-'));
  const dirs={bundled:path.join(root,'기본'),learned:path.join(root,'배움')};
  await fs.mkdir(dirs.bundled,{recursive:true});
  await fs.writeFile(path.join(dirs.bundled,'KakaoTalk.md'),'# 기본\n\n- 채팅방 찾기 ⇒ 채팅 탭 → 검색\n- 나와의 채팅 열기 ⇒ 옛 방법\n');
  assert.equal(await saveAppNote('KakaoTalk',{task:'나와의 채팅 열기',route:'친구 탭 → 내 프로필 → 나와의 채팅'},dirs),true);
  assert.equal(await saveAppNote('KakaoTalk',{task:'나와의 채팅 열기',route:'친구 탭 → 맨 위 내 프로필 → 나와의 채팅 버튼'},dirs),true);
  const notes=await readAppNotes('KakaoTalk',dirs);
  assert.match(notes,/채팅방 찾기 ⇒ 채팅 탭 → 검색/);
  assert.match(notes,/맨 위 내 프로필/);
  assert.doesNotMatch(notes,/옛 방법/);
  assert.equal(notes.match(/나와의 채팅 열기/g).length,1);
  // 다른 앱의 메모는 섞이지 않고, 경로 문자는 파일 이름에 들어가지 않습니다.
  assert.equal(await readAppNotes('notepad',dirs),'');
  assert.equal(await saveAppNote('../../evil',{task:'일하기',route:'클릭 → 클릭'},dirs),true);
  assert.equal((await fs.readdir(dirs.learned)).length,2);
  assert.deepEqual(await fs.readdir(root),['기본','배움'].sort((a,b)=>a<b?-1:1));
  // 비밀번호 문장은 가려서 저장합니다.
  await saveAppNote('KakaoTalk',{task:'잠금 풀기',route:'카톡 비번 4821이야 입력 → 확인'},dirs);
  assert.doesNotMatch(await fs.readFile(path.join(dirs.learned,'KakaoTalk.md'),'utf8'),/4821/);
  await fs.rm(root,{recursive:true,force:true});
});

test('the saved route lists what was pressed but never the text that was typed',()=>{
  const route=routeFromSteps([{tool:'click',name:'',text:'48,85'},{tool:'click',name:'나와의채팅',text:'E4'},{tool:'type',name:'',text:'비밀 메시지'},{tool:'key',name:'',text:'enter'}]);
  assert.equal(route,'클릭 (글자 없는 위치) → 클릭 «나와의채팅» → 글자 입력 → 키 «enter»');
  assert.equal(routeFromSteps([]),'');
  assert.equal(looksLikeRouteHint('프로필 눌러서 나와의 채팅 들어가'),true);
  assert.equal(looksLikeRouteHint('테스트라고 보내줘'),false);
});

test('a failed summary call falls back to the plain list of steps',async()=>{
  const note=await summarizeRoute({chat:async()=>{throw Error('모델 없음');},goal:'나에게 메시지 보내기',steps:[{tool:'click',name:'친구'},{tool:'click',name:'나와의채팅'}]});
  assert.deepEqual(note,{task:'나에게 메시지 보내기',route:'클릭 «친구» → 클릭 «나와의채팅»'});
});

const win={title:'메모 앱',handle:1,pid:2,process:'MemoApp',rect:[0,0,100,100]};
const screen={image:'bWVtbw==',imageWidth:100,imageHeight:100,texts:[],window:win,elements:[{id:1,name:'목록',type:'Button',x:10,y:10},{id:2,name:'추가',type:'Button',x:20,y:20}]};
const runTask=async(store)=>{
  const seen=[];let turn=0,summaryCalls=0;
  // 첫 동작은 "먼저 계획을 세우라"는 안내로 한 번 돌려보내질 수 있어 같은 클릭을 한 번 더 둡니다.
  const steps=[{tool:'click',text:'E1'},{tool:'click',text:'E1'},{tool:'click',text:'E2'},{tool:'reply',text:'목록과 추가를 눌렀습니다.'}].map(s=>({path:'',thought:'진행',...s}));
  const result=await runAgentLoop({input:'메모 앱에서 목록과 추가를 눌러줘',settings:{noSpec:true,toolAllow:['look','click','reply']},maxSteps:12,
    context:{selectedWindow:{handle:1,pid:2,title:'메모 앱'},appNotes:{read:async app=>store.get(app)||'',save:async(app,note)=>{store.set(app,'- '+note.task+' ⇒ '+note.route);return true;}}},
    chat:async(m,f)=>{
      if(f?.properties?.located)return JSON.stringify({located:true,selectedMatches:true,x:100,y:100,label:'관찰된 버튼'});
      if(f?.properties?.route){summaryCalls++;throw Error('Completion must not ask a model for optional notes');}
      if(f?.properties?.verified)return JSON.stringify({verified:true,quote:'메모 앱',gap:''});
      seen.push(m.map(x=>String(x.content)).join('\n'));
      return JSON.stringify(steps[Math.min(turn++,steps.length-1)]);},
    execute:async a=>a.tool==='look'?screen:{ok:true,window:win}});
  return {seen,result,summaryCalls};
};

test('a finished task leaves a note for that app, and the next task in the app starts from it',async()=>{
  const store=new Map();
  const first=await runTask(store);
  assert.equal(first.result.complete,true,first.result.answer);
  assert.equal(first.summaryCalls,0);
  assert.match(store.get('MemoApp'),/클릭 «목록» → 클릭 «추가»/);
  assert.ok(!first.seen.some(text=>text.includes('전에 성공한 방법 메모')));
  const second=await runTask(store);
  assert.ok(second.seen.some(text=>text.includes('전에 성공한 방법 메모') && text.includes('클릭 «목록» → 클릭 «추가»')));
});
