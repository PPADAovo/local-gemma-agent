import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {runAgentLoop} from '../agent-loop.mjs';
import {research} from '../research.mjs';

test('a service call naming a skill but wrapping a real tool runs that tool',async()=>{
  const executed=[];let turn=0;
  const steps=[{tool:'plugin_call',path:'shell',text:JSON.stringify({tool_name:'run',arguments:{text:'ls'}}),thought:'목록'},{tool:'reply',text:'a.txt',path:'',thought:'끝'}];
  await runAgentLoop({input:'작업공간 파일 목록 명령으로 보여줘',settings:{noSpec:true,toolAllow:['run','plugin_call','reply']},context:{},maxSteps:4,
    chat:async(m,f)=>{if(f?.properties?.verified||f?.properties?.checks)return JSON.stringify({verified:true,quote:'a.txt',gap:'',checks:[],missing:''});return JSON.stringify(steps[Math.min(turn++,steps.length-1)]);},
    execute:async a=>{executed.push(a.tool+':'+a.text);return 'a.txt';}});
  assert.ok(executed.includes('run:ls'),executed.join(','));
});

test('a step number larger than the list means the current step',async()=>{
  const results=[];let turn=0;
  const steps=[{tool:'list',path:'.',text:'',thought:'목록'},{tool:'check',text:'14',path:'',thought:'확인'},{tool:'reply',text:'a.txt',path:'',thought:'끝'}];
  await runAgentLoop({input:'파일 목록 보여줘',settings:{toolAllow:['list','reply']},context:{},maxSteps:5,
    chat:async(m,f)=>{
      if(f?.properties?.kind)return JSON.stringify({kind:'action',access:'observe',continuity:'new_topic',surface:'other',session:'any',desktop:'none',goal:'목록',skillPlan:[],workflow:'general',externalCapability:'',steps:['목록 보기','답하기'],tools:['list'],criteria:['목록을 보여 준다'],missing:''});
      if(f?.properties?.verified||f?.properties?.checks)return JSON.stringify({verified:true,quote:'a.txt',gap:'',checks:[],missing:''});
      return JSON.stringify(steps[Math.min(turn++,steps.length-1)]);},
    execute:async()=>'a.txt',log:s=>results.push(s)});
  assert.ok(!results.some(s=>/그런 단계 번호가 없습니다/.test(s)),results.join('\n'));
});

test('page reading follows only same-address redirects and names any other target',async t=>{
  const server=http.createServer((req,res)=>{
    if(req.url==='/page/'){res.writeHead(301,{Location:'/page'});return res.end();}
    if(req.url==='/page'){res.writeHead(200,{'content-type':'text/html; charset=utf-8'});return res.end('<main>날씨 &middot; 맑음</main>');}
    if(req.url==='/away'){res.writeHead(302,{Location:'/collect'});return res.end();}
    res.writeHead(200,{'content-type':'text/html'});res.end('collected');});
  server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>server.close());
  const base='http://127.0.0.1:'+server.address().port;
  const ok=await research({tool:'web_read',path:base+'/page/'});
  assert.equal(ok.text,'날씨 · 맑음');
  await assert.rejects(()=>research({tool:'web_read',path:base+'/away'}),/다른 주소로 넘겨 줍니다: .*\/collect/);
});

test('a reply asking for needed info is a question even if it ends with "주시면 진행하겠습니다"',async()=>{
  const {asksUserForInfo}=await import('../agent-loop.mjs');
  assert.equal(asksUserForInfo('자동화를 위해 아래 내용을 알려주세요.\n1. 누구에게 보내나요?\n정보를 주시면 바로 진행하겠습니다.'),true);
  assert.equal(asksUserForInfo('어느 폴더의 메모를 읽을까요?'),true);
  assert.equal(asksUserForInfo('다음 단계로 진행할까요?',{needsInput:true}),false);
  assert.equal(asksUserForInfo('파일을 저장하겠습니다.'),false);
});

test('when replies keep being rejected, auto mode switches to a larger model once before giving up',async()=>{
  let switched=0;let turn=0;
  const stuck={tool:'reply',text:'곧 정리해서 보고하겠습니다.',path:'',thought:''};
  const done={tool:'reply',text:'목록: a.txt',path:'',thought:''};
  const r=await runAgentLoop({input:'파일 목록 보여줘',settings:{noSpec:true,toolAllow:['list','reply'],manualHandoff:false},maxSteps:20,
    context:{modelStruggling:async()=>{switched++;return true;}},
    chat:async(m,f)=>{if(f?.properties?.verified||f?.properties?.checks)return JSON.stringify({verified:true,quote:'a.txt',gap:'',checks:[],missing:''});
      return JSON.stringify(switched?(turn++?done:{tool:'list',path:'.',text:'',thought:''}):stuck);},
    execute:async()=>'a.txt'});
  assert.equal(switched,1);
  assert.match(r.answer,/a\.txt/);
});

test('a card closes itself when the watched condition clears (e.g. Windows Hello unlocked the app)',async t=>{
  const {askCard,RESOLVED}=await import('../human-handoff.mjs');
  const fs=await import('node:fs/promises');const os=await import('node:os');const path=await import('node:path');
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'card-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const lines=[];let checks=0;
  const answer=await askCard({kind:'question',question:'잠겨 있어요',until:async()=>++checks>=2,untilEvery:50},path.join(dir,'inbox.jsonl'),l=>lines.push(l));
  assert.equal(answer,RESOLVED);
  assert.ok(!lines[0].includes('until'),'the watch function must not be sent to the app');
  assert.match(lines.at(-1),/^@askdone /);
});

test('once an app is approved in a request, later steps in that app do not ask again; another app still asks',async()=>{
  const {TaskApproval}=await import('../task-approval.mjs');
  const ledger=new TaskApproval();let asked=0;const ask=async()=>{asked++;return true;};
  await ledger.authorize({request:'r',description:'복사',action:{tool:'key',app:'KakaoTalk'}},ask,async()=>false);
  await ledger.authorize({request:'r',description:'붙여넣기',action:{tool:'key',app:'KakaoTalk'}},ask,async()=>false);
  assert.equal(asked,1);
  await ledger.authorize({request:'r',description:'입력',action:{tool:'type',app:'Notepad'}},ask,async()=>false);
  assert.equal(asked,2);
  await ledger.authorize({request:'r',description:'삭제',action:{tool:'delete',app:'KakaoTalk'},strict:true},ask,async()=>false);
  assert.equal(asked,3,'strict actions (delete) still ask');
});

test('a KakaoTalk request planned as desktop=none with a service tool still gets the screen tools, and no dictionary',async()=>{
  let offered=null;
  await runAgentLoop({input:'카카오톡 나에게 보내기로 바탕화면에 있는 동영상 보내줘',settings:{computerUse:true,webMode:'always',webEnabled:true,manualHandoff:false},maxSteps:1,
    context:{askUser:async()=>'작업 중지'},
    chat:async(m,f)=>{
      if(f?.properties?.kind)return JSON.stringify({kind:'action',access:'operate',continuity:'new_topic',surface:'other',session:'any',desktop:'none',goal:'동영상 보내기',skillPlan:[{name:'kakaotalk',use:'보내기'}],workflow:'general',externalCapability:'',steps:['파일 찾기','카톡 열기','보내기'],tools:['find_file','plugin_call'],criteria:['보낸다'],missing:''});
      if(f?.properties?.tool?.enum && !offered)offered=f.properties.tool.enum;
      return JSON.stringify({tool:'reply',text:'x',path:'',thought:''});},
    execute:async a=>a.tool==='windows'?{foreground:{},windows:[]}:a.tool==='plugin_search'?[]:'ok'}).catch(()=>{});
  for(const t of ['open_app','look','click'])assert.ok(offered?.includes(t),t+' missing: '+offered);
  assert.ok(!offered.includes('lookup_word'),'dictionary must not be offered');
});

test('a completion report ending with "있으면 말씀해 주세요" is not a question (so the final check still runs)',async()=>{
  const {asksUserForInfo}=await import('../agent-loop.mjs');
  assert.equal(asksUserForInfo('동영상 파일을 나와의 채팅 방으로 성공적으로 전송했습니다!\n\n이제 카카오톡에서 확인하실 수 있습니다. 추가로 도와드릴 일이 있으면 말씀해 주세요!'),false);
  assert.equal(asksUserForInfo('필요하시면 말씀해 주세요.'),false);
  assert.equal(asksUserForInfo('받는 사람을 알려 주세요. 정보를 주시면 바로 진행하겠습니다.'),true);
});

test('a finished lookup answer is accepted even if a "show the list" step is unchecked, and the model is not pushed into an old request',async()=>{
  const sent=[];let turn=0;
  const steps=[{tool:'list',path:'C:\Users\User\Desktop',text:'',thought:'목록'},{tool:'reply',text:'바탕화면에는 파일 2개(desktop.ini, desktop_record.mp4)와 폴더 3개가 있습니다. 추가로 필요한 게 있으신가요?',path:'',thought:'끝'},{tool:'open_app',text:'카카오톡',path:'',thought:'예전 요청 이어서'}];
  const r=await runAgentLoop({input:'내 컴퓨터 파일을 검토해줄래 바탕화면',recent:[{role:'user',content:'카톡 나에게 보내기로 바탕화면 동영상 보내줘'}],settings:{manualHandoff:false},maxSteps:6,context:{},
    chat:async(m,f)=>{
      if(f?.properties?.kind)return JSON.stringify({kind:'action',access:'observe',continuity:'new_topic',surface:'desktop',session:'any',desktop:'none',goal:'바탕화면 목록',skillPlan:[],workflow:'general',externalCapability:'',steps:['바탕화면 경로를 확인한다','파일 목록을 읽어온다','목록을 정리하여 사용자에게 보여준다'],tools:['list'],criteria:['목록을 보여 준다'],missing:''});
      if(f?.properties?.verified||f?.properties?.checks)return JSON.stringify({verified:true,quote:'desktop_record.mp4',gap:'',checks:[{number:1,met:true,proof:[{id:1,line:1}],gap:''}],missing:''});
      return JSON.stringify(steps[Math.min(turn++,steps.length-1)]);},
    execute:async a=>{sent.push(a.tool);return a.tool==='list'?'C:\Users\User\Desktop desktop.ini desktop_record.mp4 [폴더] 블랙홀':'ok';}});
  assert.ok(!sent.includes('open_app'),'must not resume the old KakaoTalk request: '+sent.join(','));
  assert.match(r.answer,/desktop_record\.mp4/);
});

test('a service tool named inside the input as tool_name is moved to the tool name and runs',async()=>{
  const sent=[];let turn=0;
  const steps=[{tool:'plugin_search',text:'gmail',path:'',thought:'찾기'},{tool:'plugin_call',text:JSON.stringify({tool_name:'gmail.send_attached_email',arguments:{to:'me',subject:'녹화',body:'영상',files:['desktop_record.mp4']}}),path:'',thought:'보내기'},{tool:'reply',text:'보냈습니다. 메시지 ID abc',path:'',thought:'끝'}];
  await runAgentLoop({input:'녹화 파일 지메일로 나한테 보내',settings:{noSpec:true,manualHandoff:false},maxSteps:6,context:{},
    chat:async(m,f)=>{if(f?.properties?.verified||f?.properties?.checks)return JSON.stringify({verified:true,quote:'abc',gap:'',checks:[],missing:''});return JSON.stringify(steps[Math.min(turn++,steps.length-1)]);},
    execute:async a=>{sent.push(a.tool+':'+(a.path||''));return a.tool==='plugin_search'?[{name:'gmail.send_attached_email',inputSchema:{type:'object',properties:{to:{},subject:{},body:{},files:{}},required:['to']}}]:'메시지 ID abc';}});
  assert.ok(sent.includes('plugin_call:gmail.send_attached_email'),sent.join(','));
});

test('a repeated tool name inside the input is stripped, and opening the Gmail page for a send request is redirected',async()=>{
  const sent=[];let turn=0;
  const steps=[{tool:'plugin_search',text:'gmail',path:'',thought:''},{tool:'plugin_call',path:'local.gmail.open',text:'{}',thought:'화면 열기'},{tool:'plugin_call',path:'gmail.send_attached_email',text:JSON.stringify({tool:'gmail.send_attached_email',to:'me',subject:'s',body:'b',files:['a.mp4']}),thought:''},{tool:'reply',text:'보냈습니다. 메시지 ID abc',path:'',thought:''}];
  await runAgentLoop({input:'녹화 파일 지메일로 나한테 보내',settings:{noSpec:true,manualHandoff:false},maxSteps:8,context:{},
    chat:async(m,f)=>{if(f?.properties?.verified||f?.properties?.checks)return JSON.stringify({verified:true,quote:'abc',gap:'',checks:[],missing:''});return JSON.stringify(steps[Math.min(turn++,steps.length-1)]);},
    execute:async a=>{sent.push(a.tool+':'+(a.path||'')+':'+(a.text||''));return a.tool==='plugin_search'?[{name:'gmail.send_attached_email',inputSchema:{type:'object',properties:{to:{},subject:{},body:{},files:{}},required:['to']}}]:'메시지 ID abc';}});
  assert.ok(!sent.some(s=>s.includes('local.gmail.open')),'Gmail page must not be opened: '+sent.join(' | '));
  const send=sent.find(s=>s.startsWith('plugin_call:gmail.send_attached_email'));
  assert.ok(send && !send.includes('"tool"'),send);
});
