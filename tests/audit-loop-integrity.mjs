import test from 'node:test';
import assert from 'node:assert/strict';
import {runAgentLoop,parseRecordingRequest,availableTools} from '../agent-loop.mjs';
const act=(tool,more={})=>({tool,text:'',path:'',thought:'test',...more});
async function scenario(input,script,{execute=async()=> 'ok',settings={},verdict={verified:true,quote:'ok',gap:''},context={},maxSteps=12}={}){
 const calls=[];let count=0;
 const result=await runAgentLoop({input,settings:{noSpec:true,computerUse:false,manualHandoff:false,...settings},context,maxSteps,
 chat:async(_m,f)=>{assert.ok(++count<100,'bounded scripted conversation');const p=f?.properties||{};if(p.allow)return JSON.stringify({allow:true,reason:'verified fixture'});if(p.verified)return JSON.stringify(verdict);if(p.decision)return JSON.stringify({decision:'stop',reason:'fixture'});if(!p.tool)return '{}';return JSON.stringify(script.shift()||act('reply',{text:'ok'}));},
 execute:async a=>{calls.push({...a});return execute(a);}});return {calls,result,count};
}
test('recording fast path excludes negation, approval and composite requests',()=>{
 for(const s of ['화면 녹화하지 마','화면 녹화는 하지 말고 설명해','화면 녹화하면 안 돼','화면 녹화 중단해','화면 녹화를 멈춰','화면 녹화해 달라는 뜻이 아니야','do not record screen','화면 10초 녹화하기 전에 계획을 보여주고 승인받아','화면 녹화하고 파일도 만들어'])assert.equal(parseRecordingRequest(s),null,s);
 assert.deepEqual(parseRecordingRequest('화면을 10초 녹화해서 바탕화면에 저장해'),{seconds:10,destination:'desktop'});
});
test('edit text fallback reaches execution as the actual replacement',async()=>{
 const r=await scenario('audit-fixture.txt의 old를 new로 바꿔 줘',[act('read',{path:'audit-fixture.txt'}),act('edit',{path:'audit-fixture.txt',old:'old',text:'new'})]);
 assert.equal(r.calls.find(a=>a.tool==='edit')?.new,'new');
});
test('a validation command can run again after a file mutation',async()=>{
 const r=await scenario('검사하고 audit-fix.txt를 만든 다음 같은 검사를 다시 해',[act('plan',{text:'검사\n파일 수정\n재검사'}),act('run',{text:'npm test'}),act('write',{path:'audit-fix.txt',text:'fix'}),act('run',{text:'npm test'})]);
 assert.deepEqual(r.calls.map(a=>a.tool),['run','write','run']);
});
test('file mutation does not enable repeating arbitrary side-effect commands',async()=>{
 const r=await scenario('실행하고 audit-fix.txt를 만들어',[act('plan',{text:'실행\n파일 수정'}),act('run',{text:'Send-CustomMessage'}),act('write',{path:'audit-fix.txt',text:'fix'}),act('run',{text:'Send-CustomMessage'})]);
 assert.equal(r.calls.filter(a=>a.tool==='run').length,1);
});
test('a shell repair also invalidates prior validation results',async()=>{
 const r=await scenario('검사 후 명령으로 수정하고 재검사해',[act('plan',{text:'검사\n수정\n재검사'}),act('run',{text:'node --test "tests/my file.mjs"'}),act('run',{text:'git apply fix.patch'}),act('run',{text:'node --test "tests/my file.mjs"'})]);
 assert.equal(r.calls.filter(a=>a.tool==='run').length,3);
});
test('mail receipt does not drop a required subsequent output',async()=>{
 const r=await scenario('메일을 보내고 audit-after-mail.txt 파일도 만들어 줘',[act('plan',{text:'메일 발송\n파일 생성'}),act('plugin_call',{path:'gmail.send_email',text:'{"to":"fixture@example.invalid","body":"mock"}'}),act('write',{path:'audit-after-mail.txt',text:'required'})],{execute:async a=>a.tool==='plugin_call'?{message_id:'MOCK'}:'ok'});
 assert.ok(r.calls.some(a=>a.tool==='write'),'remaining output was not executed');
});
test('read-only verification excludes mutation, shell and indirect execution tools',()=>{
 const tools=availableTools({readOnly:true,computerUse:true,brain:'api-gemini'});
 for(const name of ['run','write','edit','delete','delegate','plugin_call','type','click','open_app','schedule_add','record_screen'])assert.ok(!tools.includes(name),name);
 for(const name of ['read','list','look','windows','reply'])assert.ok(tools.includes(name),name);
});
test('explicit iteration budget is honored even for changing valid observations',async()=>{
 let n=0;
 const r=await scenario('항목을 읽어 줘',Array.from({length:15},(_,i)=>act('read',{path:'item'+i})),{settings:{maxIterations:4},execute:async()=>String(++n)});
 assert.ok(r.calls.length<=4,r.calls.length);assert.equal(r.result.complete,false);assert.match(r.result.answer,/4|한도|제한/);
});
test('task deadline stops model wait and reports an incomplete result',{timeout:500},async()=>{
 const start=Date.now();const r=await runAgentLoop({input:'값을 확인',settings:{noSpec:true,manualHandoff:false,taskTimeoutMs:30},context:{},chat:()=>new Promise(()=>{}),execute:async()=>assert.fail('no dispatch after expiry')});
 assert.ok(Date.now()-start<500);assert.equal(r.complete,false);assert.match(r.answer,/시간|제한/);
});
test('fallback verifier cannot erase its own missing requirement',async()=>{
 const r=await scenario('audit.txt 내용을 확인해 줘',[act('read',{path:'audit.txt'}),act('reply',{text:'내용을 확인했습니다.'})],{verdict:{verified:true,quote:'ok',gap:'아직 요청한 다른 항목을 확인하지 않았습니다.'}});
 assert.equal(r.result.complete,false);
});
test('fallback verifier cannot accept a quote with a changed number',async()=>{
 const r=await scenario('audit.txt 내용을 확인해 줘',[act('read',{path:'audit.txt'}),act('reply',{text:'수량은 999개입니다.'})],{execute:async()=> 'alpha beta gamma delta 123',verdict:{verified:true,quote:'alpha beta gamma delta 999',gap:''}});
 assert.equal(r.result.complete,false);
});
test('delegated operations are serialized and their observations survive in parent history',async()=>{
 let active=0,maxActive=0,parentStep=0;const seen=new Set();
 const r=await runAgentLoop({input:'두 자료를 조사해 줘',settings:{noSpec:true,manualHandoff:false,computerUse:false,toolAllow:['delegate','read','reply']},context:{},maxSteps:8,
 chat:async(messages,f)=>{if(f?.properties?.verified)return JSON.stringify({verified:true,quote:'ok',gap:''});
  const child=messages.find(m=>m.role==='user'&&['하위 A','하위 B'].includes(m.content))?.content;
  if(child){if(!seen.has(child)){seen.add(child);return JSON.stringify(act('read',{path:child}));}return JSON.stringify(act('reply',{text:'ok'}));}
  return JSON.stringify(parentStep++===0?act('plan',{text:'두 자료 확인'}):parentStep===2?act('delegate',{text:'하위 A\n하위 B'}):act('reply',{text:'ok'}));},
 execute:async()=>{active++;maxActive=Math.max(maxActive,active);await new Promise(r=>setTimeout(r,5));active--;return 'ok';}});
 assert.equal(maxActive,1);assert.equal(r.events.filter(e=>e.tool==='read'&&e.observation==='ok').length,2);
});
test('deadline after a successful tool retains the actual observation',{timeout:1000},async()=>{
 let turn=0;
 const r=await runAgentLoop({input:'fixture.txt 확인',settings:{noSpec:true,manualHandoff:false,taskTimeoutMs:40},context:{},
 chat:async()=>turn++===0?JSON.stringify(act('read',{path:'fixture.txt'})):new Promise(()=>{}),execute:async()=> 'retained evidence'});
 assert.equal(r.complete,false);assert.ok(r.events.some(e=>e.tool==='read'&&e.observation==='retained evidence'));
});
test('a failed child is not recorded as a successful delegation',async()=>{
 let parent=0,child=0;
 const r=await runAgentLoop({input:'하위로 자료 확인',settings:{noSpec:true,manualHandoff:false,computerUse:false,toolAllow:['delegate','read','reply'],maxIterations:6},context:{},
 chat:async(m,f)=>{if(f?.properties?.verified)return JSON.stringify({verified:false,quote:'',gap:'실패'});const sub=m.some(x=>x.role==='user'&&x.content==='하위 실패');
  return JSON.stringify(sub?(child++?act('reply',{text:'파일 읽기에 실패했습니다.'}):act('read',{path:'missing'})):(parent++===0?act('delegate',{text:'하위 실패'}):act('reply',{text:'파일 읽기에 실패했습니다.'})));},execute:async()=>{throw Error('fixture missing');}});
 assert.equal(r.complete,false);assert.ok(r.events.some(e=>e.tool==='delegate'&&!e.ok));assert.ok(r.events.some(e=>e.tool==='read'&&!e.ok));
});
test('parent validation can rerun after a delegated file mutation',async()=>{
 let parent=0,child=0;const commands=[];
 const script=[act('plan',{text:'검사\n수정\n재검사'}),act('run',{text:'npm test'}),act('delegate',{text:'audit-child.txt를 만들어'}),act('run',{text:'npm test'}),act('reply',{text:'ok'})];
 await runAgentLoop({input:'검사 후 하위 작업으로 audit-child.txt를 만들어 재검사해',settings:{noSpec:true,manualHandoff:false,computerUse:false,toolAllow:['delegate','run','write','read','reply'],maxIterations:12},context:{},
 chat:async(m,f)=>{if(f?.properties?.allow)return '{"allow":true}';if(f?.properties?.verified)return '{"verified":true,"quote":"ok","gap":""}';
  const sub=m.some(x=>x.role==='user'&&x.content==='audit-child.txt를 만들어');return JSON.stringify(sub?(child++===0?act('write',{path:'audit-child.txt',text:'fixed'}):act('reply',{text:'ok'})):(script[parent++]||act('reply',{text:'ok'})));},
 execute:async a=>{commands.push(a.tool);return 'ok';}});
 assert.equal(commands.filter(t=>t==='run').length,2);assert.ok(commands.includes('write'));
});
test('an observed lookup answer with an optional closing question reaches the verifier',async()=>{
 let read=false,audits=0;
 const spec={kind:'action',access:'observe',surface:'files',desktop:'none',goal:'목록 조회',steps:['자료 읽기','목록을 정리하여 보여준다'],tools:['read'],criteria:['alpha와 beta 목록을 답변으로 제공'],done_when:'목록 답변',missing:''};
 const r=await runAgentLoop({input:'자료의 목록을 보여줘',settings:{computerUse:false,manualHandoff:false,toolAllow:['read','reply']},context:{},maxSteps:8,
 chat:async(_m,f)=>{const p=f?.properties||{};if(p.kind)return JSON.stringify(spec);if(p.checks){audits++;return JSON.stringify({checks:[{number:1,met:true,proof:[{id:1,line:1}],gap:''}],stages:[],missing:''});}if(p.done||p.met)return JSON.stringify({done:false,met:false,quote:'',reason:'answer stage'});
 return JSON.stringify(read?act('reply',{text:'조회한 자료의 전체 목록은 alpha와 beta 두 항목입니다. 목록을 그대로 정리했습니다. 추가로 궁금한 점이 있으신가요?'}):act('read',{path:'list.txt'}));},execute:async()=>{read=true;return 'alpha, beta';}});
 assert.ok(audits>0,'optional question must not block verification');assert.equal(r.complete,true,r.answer);
});
test('a long answer cannot complete an unperformed external delivery step',async()=>{
 const r=await scenario('메일로 목록을 전달해',[act('plan',{text:'목록을 메일로 전달한'}),act('reply',{text:'목록을 정리하여 전달했습니다. 대상 항목과 결과를 모두 확인했으며 요청하신 전달 절차를 빠짐없이 완료했습니다.'})]);
 assert.equal(r.result.complete,false);assert.equal(r.calls.some(a=>a.tool==='plugin_call'),false);
});
