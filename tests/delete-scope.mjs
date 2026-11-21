import test from 'node:test';
import assert from 'node:assert/strict';
import {deleteScopeProblem,runAgentLoop} from '../agent-loop.mjs';

const file='C:\\Users\\User\\Desktop\\어디서나 작업\\작업공간\\치이카와달력.html';
const root='C:\\Users\\User\\Desktop\\어디서나 작업\\작업공간';
const recent=[{role:'user',content:'이거 파일 경로가 어디임'},{role:'assistant',content:'경로는 다음과 같습니다.\n\n`'+file+'`\n\n작업공간 폴더 안에 위치해 있습니다.'}];
const input='이거 그냥 지워 파일 다 지워';

test('"이거 지워" may delete the file just mentioned',()=>{
  assert.equal(deleteScopeProblem({tool:'delete',path:file},input,recent,root),'');
  assert.equal(deleteScopeProblem({tool:'delete',path:'치이카와달력.html'},input,recent,root),'');
});

test('"이거 지워" may not delete other files, the folder, or a wildcard',()=>{
  assert.match(deleteScopeProblem({tool:'delete',path:root+'\\hello.js'},input,recent,root),/직전 대화에 나온 파일만/);
  assert.match(deleteScopeProblem({tool:'delete',path:root},input,recent,root),/치이카와달력\.html/);
  assert.notEqual(deleteScopeProblem({tool:'run',text:"Remove-Item '"+root+"\\*' -Recurse"},input,recent,root),'');
  assert.equal(deleteScopeProblem({tool:'run',text:"Remove-Item '"+file+"'"},input,recent,root),'');
});

test('naming the folder explicitly is not restricted',()=>{
  assert.equal(deleteScopeProblem({tool:'delete',path:root+'\\hello.js'},'작업공간 폴더 안 파일 다 지워',recent,root),'');
  assert.equal(deleteScopeProblem({tool:'delete',path:root+'\\hello.js'},'hello.js 지워',recent,root),'');
});

test('the loop refuses a whole-folder delete for "이거 지워" and deletes only the mentioned file',async()=>{
  const executed=[];let turn=0;
  const steps=[{tool:'delete',path:root+'\\hello.js',text:'',thought:'다 지움'},{tool:'delete',path:file,text:'',thought:'그 파일만'},{tool:'reply',text:'치이카와달력.html을 지웠습니다.',path:'',thought:'끝'}];
  await runAgentLoop({input,recent,settings:{toolAllow:['delete','list','reply']},context:{root},maxSteps:6,
    chat:async(m,f)=>{
      if(f?.properties?.kind)return JSON.stringify({kind:'action',access:'operate',continuity:'followup',surface:'other',session:'any',desktop:'none',goal:'삭제',skillPlan:[],workflow:'general',externalCapability:'',steps:['지우기'],tools:['delete'],criteria:['지운다'],missing:''});
      if(f?.properties?.verified||f?.properties?.checks)return JSON.stringify({verified:true,quote:'지웠습니다',gap:'',checks:[],missing:''});
      return JSON.stringify(steps[Math.min(turn++,steps.length-1)]);},
    execute:async a=>{executed.push(a.tool+':'+a.path);return 'ok';}}).catch(()=>{});
  assert.ok(!executed.some(e=>e.endsWith('hello.js')),executed.join(','));
});

test('a path the model wrote on a "📄" line stays in the answer when no file card replaces it',async()=>{
  const r=await runAgentLoop({input:'이거 파일 경로가 어디임',recent,settings:{toolAllow:['reply']},context:{root},maxSteps:3,
    chat:async(m,f)=>{
      if(f?.properties?.kind)return JSON.stringify({kind:'chat',access:'observe',continuity:'followup',surface:'other',session:'any',desktop:'none',goal:'경로',skillPlan:[],workflow:'general',externalCapability:'',steps:['답하기'],tools:[],criteria:['경로를 답한다'],missing:''});
      if(f?.properties?.verified||f?.properties?.checks)return JSON.stringify({verified:true,quote:'치이카와달력',gap:'',checks:[],missing:''});
      return JSON.stringify({tool:'reply',text:'경로는 다음과 같습니다.\n\n📄 `'+file+'`\n\n작업공간 폴더 안에 있습니다.',path:'',thought:''});},
    execute:async()=>'ok'});
  assert.ok(String(r.answer).includes(file),r.answer);
});
