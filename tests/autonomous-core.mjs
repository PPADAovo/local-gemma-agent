import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {runAutonomousAgent,autoGroups,toExecutorAction} from '../autonomous-core.mjs';

const toolCall=(name,args)=>({content:'',tool_calls:[{function:{name,arguments:args}}]});
const answer=content=>({content,tool_calls:[]});
function scripted(steps){let i=0;const seen=[];return {seen,chatMessage:async({tools})=>{seen.push(tools.map(t=>t.function.name));return steps[Math.min(i++,steps.length-1)];}};}

test('a greeting is answered directly, complete, and never marked as needing input',async()=>{
 const {chatMessage}=scripted([answer('안녕하세요! 무엇을 도와드릴까요?')]);
 const result=await runAutonomousAgent({input:'안녕',chatMessage,execute:async()=>{throw Error('no tools');}});
 assert.equal(result.complete,true);assert.equal(result.needsInput,false);
 assert.equal(result.answer,'안녕하세요! 무엇을 도와드릴까요?');
});

test('only core tools are offered for a plain file task; mail requests also get service tools',async()=>{
 assert.deepEqual([...autoGroups('test.txt 읽고 오타 고쳐')],['core']);
 assert.ok(autoGroups('이메일 온거 전체 요약해줘').has('service'));
 assert.ok(autoGroups('메모장 열어서 입력해').has('desktop'));
 const {chatMessage,seen}=scripted([answer('네')]);
 await runAutonomousAgent({input:'test.txt 읽어줘',chatMessage,execute:async()=>''});
 assert.ok(seen[0].includes('read')&&seen[0].includes('enable_tools'));
 assert.ok(!seen[0].includes('click')&&!seen[0].includes('make_xlsx'),seen[0].join(','));
});

test('read → edit → read runs through the executor with the existing action shapes',async()=>{
 const actions=[];
 const {chatMessage}=scripted([
  toolCall('read',{path:'a.txt'}),
  toolCall('edit',{path:'a.txt',before:'helo',after:'hello'}),
  toolCall('read',{path:'a.txt',offset:0}),
  answer('a.txt의 오타 helo를 hello로 고치고 다시 읽어 확인했습니다.')
 ]);
 let content='helo world';
 const result=await runAutonomousAgent({input:'a.txt 오타 고쳐',chatMessage,execute:async a=>{actions.push(a);if(a.tool==='edit'){content=content.replace(a.old,a.new);return '수정함';}return content;}});
 assert.deepEqual(actions.map(a=>a.tool),['read','edit','read']);
 assert.equal(actions[1].old,'helo');assert.equal(actions[1].new,'hello');
 assert.equal(content,'hello world');assert.equal(result.complete,true);
});

test('calling a tool from a closed group opens that group instead of failing',async()=>{
 const actions=[];
 const {chatMessage,seen}=scripted([toolCall('calc',{expression:'2+2'}),answer('4입니다.')]);
 await runAutonomousAgent({input:'이거 좀 봐줘',chatMessage,execute:async a=>{actions.push(a.tool);return '4';}});
 assert.deepEqual(actions,['calc']);
 assert.ok(seen[1].includes('make_xlsx'),'office group is open on the next turn');
});

test('a claimed completion without any executed action is pushed back, then reported as unverified',async()=>{
 const {chatMessage}=scripted([answer('파일을 저장했습니다.'),answer('파일을 저장했습니다.')]);
 const result=await runAutonomousAgent({input:'메모 저장해줘',chatMessage,execute:async()=>''});
 assert.equal(result.complete,false);assert.match(result.answer,/확인하지 못했습니다/);
});

test('an identical side effect is not executed twice',async()=>{
 const runs=[];
 const {chatMessage}=scripted([toolCall('run',{command:'echo 1'}),toolCall('run',{command:'echo 1'}),answer('실행했습니다.')]);
 await runAutonomousAgent({input:'명령 실행해',chatMessage,execute:async a=>{runs.push(a.text);return '1';}});
 assert.deepEqual(runs,['echo 1']);
});

test('a screen action is followed by an automatic look and the next input targets that observed window',async()=>{
 const actions=[];const window={handle:7,pid:3,title:'메모장',rect:[0,0,100,100]};
 const frame={window,left:0,top:0,width:100,height:100,imageWidth:100,imageHeight:100,image:'aW1n',elements:[{id:1,name:'본문',type:'Document',x:50,y:50}]};
 const {chatMessage}=scripted([toolCall('open_app',{name:'메모장'}),toolCall('click',{target:'E1'}),toolCall('type',{text:'안녕'}),answer('메모장에 안녕을 입력했습니다.')]);
 await runAutonomousAgent({input:'메모장 열어서 안녕 입력해',chatMessage,execute:async a=>{if(a.tool!=='installed_apps')actions.push(a);return a.tool==='look'?frame:a.tool==='installed_apps'?'메모장, 그림판':'ok';}});
 assert.deepEqual(actions.map(a=>a.tool),['open_app','look','click','look','type','look']);
 assert.equal(actions[2].absX,50);assert.equal(actions[4].observedHandle,7);
});

test('a message the user sends mid-task is read and passed to the model',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'auto-inbox-'));const inbox=path.join(dir,'inbox.jsonl');
 const previous=process.env.GEMMA_INBOX;process.env.GEMMA_INBOX=inbox;
 try{
  let turn=0,sawExtra=false;
  const result=await runAutonomousAgent({input:'메일 보내줘',execute:async()=>'ok',chatMessage:async({messages})=>{
   if(turn++===0){await fs.writeFile(inbox,JSON.stringify({text:'내 유튜브 링크도 넣어줘'})+'\n');return toolCall('list',{path:''});}
   sawExtra||=messages.some(m=>String(m.content).includes('내 유튜브 링크도 넣어줘'));
   return answer('반영했습니다.');
  }});
  assert.ok(sawExtra);assert.deepEqual(result.injected,['내 유튜브 링크도 넣어줘']);
 }finally{if(previous===undefined)delete process.env.GEMMA_INBOX;else process.env.GEMMA_INBOX=previous;await fs.rm(dir,{recursive:true,force:true});}
});

test('service call arguments are passed to the executor as a JSON object',()=>{
 const action=toExecutorAction('service_call',{name:'gmail.search_email_ids',args:{query:'in:inbox',max_results:10}});
 assert.equal(action.tool,'plugin_call');assert.equal(action.path,'gmail.search_email_ids');
 assert.deepEqual(JSON.parse(action.text),{query:'in:inbox',max_results:10});
});

test('app notes are shown the first time an app screen is seen, and a learned route is saved only after a real operation',async()=>{
 const window={handle:9,pid:4,title:'제목 없음 - 그림판',process:'mspaint',rect:[0,0,100,100]};
 const frame={window,left:0,top:0,width:100,height:100,imageWidth:100,imageHeight:100,image:'aW1n',elements:[{id:1,name:'크기 조정',type:'Button',x:10,y:10}]};
 const saved=[],reads=[];let notesShown=false;
 const appNotes={read:async app=>{reads.push(app);return '- 캔버스 크기 ⇒ Ctrl+W';},save:async(app,note)=>{saved.push([app,note]);return true;}};
 const steps=[toolCall('save_app_note',{task:'캔버스 크기',route:'Ctrl+W'}),toolCall('open_app',{name:'그림판'}),toolCall('key',{keys:'ctrl+w'}),toolCall('save_app_note',{task:'캔버스 크기 바꾸기',route:'Ctrl+W → 픽셀 → 가로·세로 입력 → 확인'}),answer('바꿨습니다.')];
 let i=0;
 await runAutonomousAgent({input:'그림판 캔버스 크기 바꿔줘',context:{appNotes},execute:async a=>a.tool==='look'?frame:'ok',
  chatMessage:async({messages})=>{notesShown||=messages.some(m=>String(m.content).includes('전에 성공한 방법 메모'));return steps[i++];}});
 assert.deepEqual(reads,['mspaint'],'notes are read once for the app');
 assert.ok(notesShown);
 assert.equal(saved.length,1,'the first save (before any operation) is refused');
 assert.equal(saved[0][0],'mspaint');assert.match(saved[0][1].route,/Ctrl\+W/);
});

test('related skills are listed in the instructions and can be read with the skill tool',async()=>{
 const actions=[];let system='';
 const steps=[toolCall('skill',{name:'paint-draw'}),answer('설명서를 읽었습니다.')];let i=0;
 await runAutonomousAgent({input:'그림판에 원 그려줘',settings:{skillsForRequest:async()=>[{name:'paint-draw',description:'그림판에 도형을 그리는 방법'}]},
  execute:async a=>{if(a.tool!=='installed_apps')actions.push(a);return a.tool==='installed_apps'?'그림판':'# paint-draw';},chatMessage:async({messages})=>{system=messages[0].content;return steps[i++];}});
 assert.match(system,/paint-draw: 그림판에 도형을 그리는 방법/);
 assert.deepEqual(actions.map(a=>[a.tool,a.text]),[['skill','paint-draw']]);
});

import {namedApps} from '../autonomous-core.mjs';
test('apps named in a request are recognized, including version suffixes and Korean nicknames',()=>{
 const apps=['그림판','한글 2024','Adobe Premiere Pro 2020','Blender 5.2','카카오톡'];
 assert.deepEqual(namedApps(apps,'한글로 보고서 써줘'),['한글 2024']);
 assert.deepEqual(namedApps(apps,'프리미어로 영상 잘라줘'),['Adobe Premiere Pro 2020']);
 assert.deepEqual(namedApps(apps,'카톡 열어줘'),['카카오톡']);
 assert.deepEqual(namedApps(apps,'사진 밝게 보정해줘'),[]);
});

test('app work without a named app gets the installed app list and the choice rule; a named app is confirmed instead',async()=>{
 const run=async input=>{let first='';const calls=[];
  await runAutonomousAgent({input,execute:async a=>{calls.push(a.tool);return a.tool==='installed_apps'?'그림판, 한글 2024, 사진':'ok';},
   chatMessage:async({messages})=>{first=messages.filter(m=>m.role==='user').map(m=>m.content).join('\n');return answer('네');}});
  return {first,calls};};
 const unnamed=await run('사진 밝게 보정해줘');
 assert.match(unnamed.first,/앱 고르기/);assert.match(unnamed.first,/설치 앱 목록: 그림판, 한글 2024, 사진/);
 const named=await run('한글로 보고서 작성해줘');
 assert.match(named.first,/이미 설치돼 있습니다: 한글 2024/);assert.doesNotMatch(named.first,/설치 앱 목록/);
 const chat=await run('오늘 날씨 어때');
 assert.deepEqual(chat.calls,[],'plain questions do not load the app list');
});

test('a confirmation question during work is asked with buttons and the task continues with the answer',async()=>{
 const cards=[];let i=0;
 const steps=[toolCall('web_search',{query:'blender download'}),answer('설치를 시작할까요?'),answer('설치를 진행했습니다.')];
 const result=await runAutonomousAgent({input:'블랜더 깔아줘',context:{askUser:async card=>{cards.push(card);return '네, 진행해 주세요';}},
  execute:async a=>a.tool==='installed_apps'?'Blender 5.2, 그림판':'results',chatMessage:async()=>steps[i++]});
 assert.equal(cards.length,1);assert.deepEqual(cards[0].options,['네, 진행해 주세요','아니요, 멈춰 주세요']);
 assert.deepEqual(result.injected,['네, 진행해 주세요']);assert.equal(result.answer,'설치를 진행했습니다.');
});

// 2026-11-20 블렌더 사례: 안내만 하고 떠넘기기, "직접해줘" 라우팅, 반복 감지, blender_python.
test('"직접해줘" and 3D object requests open desktop tools including blender_python',async()=>{
 for(const input of ['직접해줘','와인잔 만들어줘','머그컵 3D로 만들어','블랜더로 해줘'])assert.ok(autoGroups(input).has('desktop'),input);
 const {chatMessage,seen}=scripted([answer('네')]);
 await runAutonomousAgent({input:'와인잔 만들어줘',chatMessage,execute:async()=>''});
 assert.ok(seen[0].includes('app_script'),seen[0].join(','));
 assert.deepEqual(toExecutorAction('blender_python',{code:'x()',name:'머그컵'}),{thought:'자율 실행',tool:'app_script',app:'blender',mode:'live',text:'x()',path:'머그컵'});
 assert.deepEqual(toExecutorAction('app_script',{app:'freecad',code:'y()',name:'브래킷',mode:'background'}),{thought:'자율 실행',tool:'app_script',app:'freecad',mode:'background',text:'y()',path:'브래킷'});
});
test('an instructions-only refusal with no tool use is pushed back to actually act',async()=>{
 const actions=[];
 const {chatMessage}=scripted([
  answer('제가 직접 조작하기에는 화면의 미세한 클릭이 어려울 수 있으니, 직접 따라 하실 수 있도록 단계별로 알려드릴게요. 1. Delete 2. Shift+A'),
  toolCall('blender_python',{code:'make_wine_glass()',name:'와인잔'}),
  answer('와인잔을 만들어 저장했습니다.')]);
 const result=await runAutonomousAgent({input:'와인잔 만들어줘',chatMessage,execute:async a=>{actions.push(a.tool);return {ok:true,report:'Blender 실행 성공',image:'aW1n'};}});
 assert.deepEqual(actions.filter(t=>t!=='installed_apps'),['app_script']);assert.equal(result.complete,true);
});
test('instructions-only pushback is bounded and does not affect plain questions',async()=>{
 const refusal=answer('블렌더를 직접 조작해서 만드는 것은 기술적으로 한계가 있습니다. 어떤 단축키가 잘 안 되나요?');
 const {chatMessage}=scripted([refusal]);
 let calls=0;
 const result=await runAutonomousAgent({input:'직접해줘',chatMessage:async o=>{calls++;return chatMessage(o);},execute:async()=>''});
 assert.equal(calls,3);assert.ok(result.answer.includes('한계'));
 const plain=scripted([answer('Blender에서 X는 삭제 단축키입니다. 직접 따라 하시면 됩니다.')]);
 let n=0;await runAutonomousAgent({input:'블렌더 삭제 단축키가 뭐야?',chatMessage:async o=>{n++;return plain.chatMessage(o);},execute:async()=>''});
 assert.equal(n,1);
});
test('a repeated identical result blocks that call and asks for another strategy before stopping',async()=>{
 const frame={window:{handle:5,pid:6,title:'Blender',process:'blender',rect:[0,0,100,100]},imageWidth:100,imageHeight:100,left:0,top:0,width:100,height:100,elements:[],image:'aW1n'};
 const executed=[];
 const steps=[toolCall('look',{}),...Array(4).fill(toolCall('key',{keys:'x'})),toolCall('blender_python',{code:'make_mug()',name:'머그'}),answer('머그컵을 만들었습니다.')];
 const {chatMessage}=scripted(steps);
 const result=await runAutonomousAgent({input:'블렌더에서 머그컵 만들어줘',chatMessage,execute:async a=>{executed.push(a.tool);return a.tool==='look'?frame:a.tool==='app_script'?{ok:true,report:'성공'}:{ok:true,keys:'x'};}});
 assert.equal(executed.filter(t=>t==='key').length,2);
 assert.ok(executed.includes('app_script'));assert.equal(result.complete,true);
});
// 2026-11-20 와인잔: .blend를 만들고 링크만 쓴 채 끝냄 → 사용자 화면엔 아무 변화가 없었음.
test('a finished Blender model must be opened with open_file before the answer is accepted',async()=>{
 const blend='C:/작업공간/Blender/와인잔.blend';
 const {chatMessage}=scripted([toolCall('blender_python',{code:'make_wine_glass()',name:'와인잔'}),answer('와인잔을 완성했습니다. [열기](와인잔.blend)'),
  toolCall('open_file',{path:blend}),answer('와인잔을 만들어 열어 두었습니다.')]);
 const ran=[];
 const result=await runAutonomousAgent({input:'와인잔 하나 만들어줄래',chatMessage,execute:async a=>{ran.push(a.tool);return a.tool==='app_script'?{ok:true,report:'Blender 실행 성공',blend}:'열었습니다';}});
 // look은 화면을 바꾸는 조작 뒤 자동으로 찍는 확인 화면
 assert.deepEqual(ran.filter(t=>!['installed_apps','look'].includes(t)),['app_script','open_file']);
 assert.equal(result.answer,'와인잔을 만들어 열어 두었습니다.');assert.equal(result.complete,true);
});
test('a Blender result with remaining problems cannot be reported as done until fixed',async()=>{
 const results=[{ok:false,warnings:['꽃병에 면이 없어 렌더에 보이지 않습니다'],report:'문제'},{ok:true,report:'Blender 실행 성공'}];
 const {chatMessage}=scripted([toolCall('blender_python',{code:'bad()',name:'꽃병'}),answer('꽃병을 만들었습니다.'),toolCall('blender_python',{code:'v=lathe("꽃병",[(0,0),(0.04,0.2)])',name:'꽃병'}),answer('꽃병을 만들었습니다.')]);
 let i=0;const ran=[];
 const result=await runAutonomousAgent({input:'꽃병 만들어줘',chatMessage,execute:async a=>{if(a.tool==='app_script'){ran.push(a.text);return results[i++];}return '';}});
 assert.equal(ran.length,2);assert.equal(result.complete,true);
});

// 2026-11-20 거짓 완료·글자뿐인 파일 열기·실시간 Blender
import {requiredObjects,missingObjects,grewObjects,asksBigger} from '../autonomous-core.mjs';
const glass={name:'와인잔',type:'MESH',dimensions:[0.08,0.08,0.2]},floor={name:'바닥',type:'MESH',dimensions:[2,2,0]};
test('required objects are read from the request and matched against real scene names',()=>{
 assert.deepEqual(requiredObjects('와인잔 크게 하고 옆에 쿠키 담긴 접시 놓아줘').sort(),['와인잔','접시','쿠키'].sort());
 assert.deepEqual(requiredObjects('파란 꽃병 만들어줘'),['꽃병']);
 assert.deepEqual(requiredObjects('머그컵 만들어줘'),['머그']);
 assert.deepEqual(missingObjects(['와인잔','접시','쿠키'],[glass,floor,{name:'Plate',type:'MESH',dimensions:[0.2,0.2,0.02]}]),['쿠키']);
 assert.equal(asksBigger('와인잔 크게 해줘'),true);
 assert.equal(grewObjects({와인잔:[0.08,0.08,0.2]},[{...glass,dimensions:[0.12,0.12,0.3]}]),true);
 assert.equal(grewObjects({와인잔:[0.08,0.08,0.2]},[glass]),false);
 assert.equal(grewObjects(null,[glass]),null);
});
test('a missing requested object or an unchanged size ends as 미완료 with the real scene, not a success claim',async()=>{
 const scene={ok:true,report:'Blender 실행 성공',live:true,before:{와인잔:[0.08,0.08,0.2]},objects:[glass,floor]};
 const {chatMessage}=scripted([toolCall('blender_python',{code:'pass',name:'잔'}),answer('와인잔을 크게 하고 쿠키 접시를 놓았습니다.')]);
 const result=await runAutonomousAgent({input:'와인잔 크게 하고 옆에 쿠키 담긴 접시 놓아줘',chatMessage,execute:async a=>a.tool==='app_script'?scene:''});
 assert.equal(result.complete,false);assert.match(result.answer,/^미완료/);
 assert.match(result.answer,/접시·쿠키|쿠키·접시/);assert.match(result.answer,/커지지 않았습니다/);assert.match(result.answer,/와인잔\(8×8×20cm\)/);
});
test('an answer that claims objects absent from the scene is pushed back, then reported as 미완료',async()=>{
 const {chatMessage}=scripted([toolCall('blender_python',{code:'make_wine_glass()',name:'와인잔'}),answer('와인잔과 접시를 모두 화면 안에 배치했습니다.')]);
 let calls=0;
 const result=await runAutonomousAgent({input:'와인잔 만들어줘',chatMessage:async o=>{calls++;return chatMessage(o);},execute:async a=>a.tool==='app_script'?{ok:true,report:'성공',live:true,objects:[glass,floor]}:''});
 assert.equal(result.complete,false);assert.match(result.answer,/답에 쓴 접시/);assert.ok(calls>=4);
});
test('result file cards use real existing paths from tool results and drop model-written file lines',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cards-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const blend=path.join(dir,'와인잔.blend');await fs.writeFile(blend,'x');
 const {chatMessage}=scripted([toolCall('blender_python',{code:'make_wine_glass()',name:'와인잔'}),answer('와인잔을 만들었습니다.\n📄 C:/가짜/없는파일.blend\n[[FILE:C:/가짜/x.blend]]')]);
 const result=await runAutonomousAgent({input:'와인잔 만들어줘',chatMessage,execute:async a=>a.tool==='app_script'?{ok:true,report:'성공',live:true,blend,png:path.join(dir,'없음.png'),objects:[glass,floor]}:''});
 assert.equal(result.complete,true);
 assert.ok(result.answer.endsWith('결과 파일:\n📄 '+blend),result.answer);
 assert.ok(!result.answer.includes('가짜'));
});
test('opening an older .blend than the latest result is refused with the exact latest path',async()=>{
 const latest='C:\작업공간\Blender\와인잔_접시_최종.blend';
 const {chatMessage}=scripted([toolCall('blender_python',{code:'pass',name:'와인잔_접시_최종'}),toolCall('open_file',{path:'C:/작업공간/Blender/와인잔.blend'}),toolCall('open_file',{path:latest}),answer('열었습니다.')]);
 const opened=[];
 await runAutonomousAgent({input:'와인잔 만들어줘',chatMessage,execute:async a=>{if(a.tool==='open_file')opened.push(a.path);return a.tool==='app_script'?{ok:true,report:'성공',blend:latest,objects:[glass,floor]}:'열었습니다';}});
 assert.deepEqual(opened,[latest]);
});
test('a final render that does not show the request blocks the done claim; a later matching render passes',async()=>{
 const chair=n=>({name:'의자 '+n,type:'MESH',dimensions:[0.4,0.4,0.8],faces:6});
 const results=[{ok:true,report:'성공',live:true,image:'aW1nMQ==',objects:[chair('좌판'),floor]},{ok:true,report:'성공',live:true,image:'aW1nMg==',objects:[chair('좌판'),chair('다리'),floor]}];
 const verdicts=[{matches:false,missing:['다리 4개'],visible:['좌판'],reason:'다리가 없음'},{matches:true,missing:[],visible:['좌판','다리'],reason:''}];
 let i=0,v=0;const seen=[];
 const {chatMessage}=scripted([toolCall('app_script',{app:'blender',code:'a',name:'의자'}),answer('의자를 만들었습니다.'),toolCall('app_script',{app:'blender',code:'b',name:'의자'}),answer('의자를 만들었습니다.')]);
 const result=await runAutonomousAgent({input:'의자 만들어줘',chatMessage,context:{verifyImage:async({image})=>{seen.push(image);return verdicts[v++];}},
  execute:async a=>a.tool==='app_script'?results[i++]:''});
 assert.deepEqual(seen,['aW1nMQ==','aW1nMg==']);assert.equal(i,2);assert.equal(result.complete,true);
});
test('re-runs within a task keep the first result file name instead of creating _v2/_final copies',async()=>{
 const names=[];
 const {chatMessage}=scripted([toolCall('app_script',{app:'blender',code:'a',name:'의자'}),toolCall('app_script',{app:'blender',code:'b',name:'의자_final_v2'}),toolCall('app_script',{app:'freecad',code:'c',name:'브래킷'}),answer('고쳤습니다.')]);
 await runAutonomousAgent({input:'의자 고쳐줘',chatMessage,execute:async a=>{if(a.tool==='app_script')names.push(a.app+':'+a.path);return a.tool==='app_script'?{ok:true,report:'성공'}:'';}});
 assert.deepEqual(names,['blender:의자','blender:의자','freecad:브래킷']);
});
test('identical results that differ only by a timestamp still count as a repeat',async()=>{
 let n=0,t=0;
 const {chatMessage}=scripted([...Array(6).fill(toolCall('app_script',{app:'freecad',code:'same()',name:'b'})),answer('끝')]);
 await runAutonomousAgent({input:'브래킷 만들어줘',chatMessage,execute:async a=>{if(a.tool!=='app_script')return '';n++;return {ok:false,report:'형상이 없습니다 · 수정 2026. 11. 21. 오전 11:3'+(t++)+':0'+t};}});
 assert.ok(n<=3,'executed '+n);
});
test('files that a run command created in the workspace during the task become result cards',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'run-cards-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 await fs.writeFile(path.join(dir,'old.blend'),'x');await fs.utimes(path.join(dir,'old.blend'),new Date(2020,1,1),new Date(2020,1,1));
 const {chatMessage}=scripted([toolCall('run',{command:'& "C:/Program Files/x/x.exe" --python "make.py"'}),answer('의자를 만들었습니다.')]);
 const result=await runAutonomousAgent({input:'의자 만들어줘',chatMessage,context:{root:dir},execute:async a=>{if(a.tool==='run'){await fs.writeFile(path.join(dir,'chair.blend'),'b');await fs.writeFile(path.join(dir,'make.py'),'s');}return '종료 코드 0';}});
 assert.ok(result.answer.includes('📄 '+path.join(dir,'chair.blend')),result.answer);
 assert.ok(!result.answer.includes('old.blend')&&!result.answer.includes('make.py'));
});
