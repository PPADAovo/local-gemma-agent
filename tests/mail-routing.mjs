import assert from 'node:assert/strict';
import test from 'node:test';
import {requestedArtifact,runAgentLoop} from '../agent-loop.mjs';
import {desktopOperation,relevantSkills} from '../skills.mjs';
const act=(tool,text='',path='')=>({tool,text,path,thought:'검증'});
// 2026-11-14 정리: "기존 메일을 제목으로 찾아 캡처" 바로가기는 코드에서 없어졌습니다(메일은 연결된 Gmail 도구로 처리).
// 메일 발송·스크린샷 요청이 정해진 바로가기로 새지 않는지만 확인합니다.
test('sending mail with a screenshot never becomes a fixed capture shortcut',()=>{
  for(const text of ['테스트 이메일 하나 보내 스크린샷 하나 찍어서','화면 캡처해서 지메일로 보내줘','메일 작성하고 스크린샷 찍어줘','"회의 안내" 메일 캡처해줘'])
    assert.equal(requestedArtifact(text),null,text);
});
const spec={kind:'action',access:'operate',surface:'web',desktop:'none',session:'any',goal:'메일 발송',steps:[],tools:['plugin_search'],criteria:[],done_when:'결과 확인',missing:''};
// 2026-11-14 정리: 브라우저 도구(browser_*)는 이제 개인 브라우저 모드에서만 제공됩니다. 메일은 서비스 도구로 처리하고 작성창을 강제로 열지 않는지만 확인합니다.
test('attachment and capture mail use service tools and do not force a compose window',async()=>{
 for(const input of ['파일을 첨부해서 메일 보내줘','테스트 메일 보내고 스크린샷 찍어줘']){
  const calls=[];
  await runAgentLoop({input,settings:{computerUse:true,toolAllow:['open_url','look','browser_open','plugin_search','plugin_call']},context:{},maxSteps:3,
   chat:async(_m,f)=>{if(f.properties.kind)return JSON.stringify(spec);
    assert.ok(f.properties.tool.enum.includes('plugin_search'));
    return JSON.stringify(act('plugin_search','gmail'));},
   execute:async a=>{calls.push(a.tool);return '사용 가능한 Gmail 도구';}});
  assert.ok(!calls.includes('open_url'),calls.join(','));
  // 스크린샷 메일은 서비스 검색 전에 먼저 화면을 캡처합니다(현재 설계).
  assert.ok(calls.includes('plugin_search') || (/스크린샷/.test(input) && calls[0]==='look'),calls.join(','));
 }
});
test('a text-only denial without an attempt gets one chance to use enabled tools',async()=>{
 const calls=[];let replies=0;
 await runAgentLoop({input:'메일 보내줘',settings:{noSpec:true,toolAllow:['plugin_search','plugin_call']},context:{},maxSteps:8,
  chat:async(_m,f)=>JSON.stringify(replies++===0?act('reply','저는 텍스트 기반 언어 모델이므로 메일을 보낼 수 없습니다.'):calls.length?act('reply','Gmail 연결이 필요합니다.'):act('plugin_search','gmail')),
  execute:async a=>{calls.push(a.tool);throw Error('Gmail 연결이 필요합니다.');}});
 assert.deepEqual(calls,['plugin_search']);
});
test('repeated unsupported capability denial never becomes a completed task',async()=>{
 const result=await runAgentLoop({input:'메일 보내줘',settings:{noSpec:true,toolAllow:['plugin_search']},context:{},maxSteps:8,
  chat:async()=>JSON.stringify(act('reply','저는 텍스트 기반 언어 모델입니다.')),execute:async()=>assert.fail('no scripted tool')});
 assert.equal(result.complete,false);
});
test('an actual tool failure can be reported without forced sending',async()=>{
 let attempted=false;
 const result=await runAgentLoop({input:'메일 보내줘',settings:{noSpec:true,toolAllow:['plugin_call']},context:{},maxSteps:5,
  chat:async()=>JSON.stringify(attempted?act('reply','Gmail 권한 오류로 발송하지 못했습니다.'):act('plugin_call','{}','gmail.send_email')),
  execute:async()=>{attempted=true;throw Error('Gmail 권한 오류');}});
 assert.equal(result.complete,false);
});
test('a capability explanation with all execution tools disabled is allowed',async()=>{
 const result=await runAgentLoop({input:'왜 메일을 보낼 수 없어?',settings:{noSpec:true,toolAllow:[]},context:{},maxSteps:4,
  chat:async()=>JSON.stringify(act('reply','현재 설정에는 메일 발송 기능이 없습니다.')),execute:async()=>assert.fail()});
 assert.match(result.answer,/기능이 없습니다/);
});
test('an attachment guide runs before discovery instead of being replaced by compose',async()=>{
 const calls=[];
 await runAgentLoop({input:'파일을 첨부해서 메일 보내줘',
  settings:{computerUse:true,toolAllow:['skill','plugin_search','plugin_call','open_url','look','browser_open'],
   skills:[{name:'gmail-attachments',description:'메일 첨부 발송'}]},
  context:{},maxSteps:3,
  chat:async(_m,f)=>JSON.stringify(f.properties.kind?spec:act('plugin_search','gmail')),
  execute:async a=>{calls.push(a.tool);return '도구와 스킬 내용';}});
 assert.equal(calls[0],'skill');
 assert.ok(calls.includes('plugin_search'));
 assert.ok(!calls.includes('open_url'));
});
// 2026-11-14 정리: 일반 메일도 작성창을 자동으로 열지 않고, 모델이 고른 도구로 처리합니다(연결된 Gmail 도구 우선).
test('ordinary mail does not auto-open a compose window',async()=>{
 const calls=[];
 await runAgentLoop({input:'테스트 메일 보내줘',settings:{computerUse:true,toolAllow:['open_url','look']},context:{},maxSteps:1,
  chat:async(_m,f)=>JSON.stringify(f.properties.kind?spec:act('reply','진행 중')),
  execute:async a=>{calls.push(a.tool);return 'Gmail 작성창';}});
 assert.ok(!calls.includes('open_url'),calls.join(','));
});
test('saved look capture paths reach the model for attachment selection',async()=>{
 let seen=false;
 await runAgentLoop({input:'화면 캡처해서 메일 보내줘',settings:{noSpec:true,toolAllow:['look','plugin_search']},context:{},maxSteps:3,
  chat:async messages=>{
   const observation=messages.find(m=>m.role==='user' && m.content.includes('Saved screenshot file'));
   if(observation){assert.match(observation.content,/캡처\/화면-test.jpg/);seen=true;}
   return JSON.stringify(seen?act('plugin_search','gmail'):act('look'));},
  execute:async a=>a.tool==='look'?{image:'aGVsbG8=',imageWidth:1,imageHeight:1,elements:[],window:{title:'Gmail',process:'chrome'},capturePath:'캡처/화면-test.jpg'}:'Gmail 도구'});
 assert.ok(seen);
});
test('a missing service path is repaired from the latest discovered tool list',async()=>{
 const calls=[];let stage=0,usedConstrainedRepair=false;
 const profile={name:'gmail.get_profile',description:'현재 Gmail 계정 주소 조회',inputSchema:{type:'object',properties:{},required:[]},annotations:{readOnlyHint:true}};
 const result=await runAgentLoop({
 input:'내 Gmail 프로필 이메일 주소를 확인해 줘',
 settings:{noSpec:true,toolAllow:['plugin_search','plugin_call']},
 context:{},maxSteps:8,
 chat:async(_messages,format,options)=>{
  if(format.properties.verified)return JSON.stringify({verified:true,quote:'person@example.test',gap:''});
  if(options?.direct){
   if(format.properties.path?.enum?.includes('gmail.get_profile')){
    usedConstrainedRepair=true;
    return JSON.stringify({path:'gmail.get_profile',text:'{}',thought:'Gmail 프로필 조회'});
   }
   return JSON.stringify({tool:'blocked',text:'기존 경로를 사용할 수 없습니다.',path:'',thought:'중단'});
  }
  if(stage++===0)return JSON.stringify(act('plugin_search','gmail'));
  if(stage===2)return JSON.stringify({tool:'plugin_call',path:'',text:'{}',thought:'내 이메일 주소 확인'});
  return JSON.stringify(act('reply','내 Gmail 주소는 person@example.test입니다.'));
 },
 execute:async command=>{
  calls.push(command);
  if(command.tool==='plugin_search')return [profile];
  if(command.path==='gmail.get_profile')return 'person@example.test';
  return '';
 }
 });
 assert.equal(usedConstrainedRepair,true);
 assert.deepEqual(calls.map(call=>call.tool),['plugin_search','plugin_call']);
 assert.equal(calls.at(-1).path,'gmail.get_profile');
 assert.equal(result.complete,true,result.answer);
});
test('a Gmail skill name triggers service discovery instead of being called as a tool',async()=>{
 const calls=[];let stage=0,directCalls=0;
 const send={name:'gmail.send_email',description:'이메일 발송',inputSchema:{type:'object',properties:{to:{type:'string'}},required:['to']}};
 await runAgentLoop({
  input:'Gmail 첨부파일 발송',
  settings:{noSpec:true,toolAllow:['skill','plugin_search','plugin_call'],skills:[{name:'gmail-attachments',description:'Gmail 첨부파일 발송 안내'}]},
  context:{},maxSteps:8,
  chat:async(_messages,_format,options)=>{
   if(options?.direct){directCalls++;return JSON.stringify({tool:'blocked',text:'서비스 검색 필요',path:'',thought:'중단'});}
   if(stage++===0)return JSON.stringify({tool:'plugin_call',path:'gmail-attachments',text:'{}',thought:'Gmail 발송'});
   if(stage===2)return JSON.stringify({tool:'plugin_call',path:'gmail.send_email',text:'{"to":"person@example.test"}',thought:'Gmail 발송'});
   return JSON.stringify(act('reply','이메일을 발송했습니다.'));
  },
  execute:async action=>{
   calls.push(action);
   if(action.tool==='plugin_search')return [send];
   if(action.tool==='plugin_call')return 'sent';
   return '스킬 내용';
  }
 });
 assert.equal(directCalls,0);
 assert.deepEqual(calls.map(call=>call.tool),['skill','plugin_search','plugin_call']);
 assert.match(calls[1].text,/gmail/i);
 assert.equal(calls[2].path,'gmail.send_email');
});
test('an empty path in a Gmail attachment request triggers Gmail discovery',async()=>{
 const calls=[];let stage=0,directCalls=0;
 const send={name:'gmail.send_email',description:'이메일 발송',inputSchema:{type:'object',properties:{to:{type:'string'}},required:['to']}};
 await runAgentLoop({
  input:'이메일 첨부 발송',
  settings:{noSpec:true,toolAllow:['skill','plugin_search','plugin_call'],skills:[{name:'gmail-attachments',description:'Gmail 첨부파일 발송 안내'}]},
  context:{},maxSteps:8,
  chat:async(_messages,_format,options)=>{
   if(options?.direct){directCalls++;return JSON.stringify({tool:'blocked',text:'서비스 검색 필요',path:'',thought:'중단'});}
   if(stage++===0)return JSON.stringify({tool:'plugin_call',path:'',text:'{}',thought:'이메일 발송'});
   if(stage===2)return JSON.stringify({tool:'plugin_call',path:'gmail.send_email',text:'{"to":"person@example.test"}',thought:'이메일 발송'});
   return JSON.stringify(act('reply','이메일을 발송했습니다.'));
  },
  execute:async action=>{
   calls.push(action);
   if(action.tool==='plugin_search')return [send];
   if(action.tool==='plugin_call')return 'sent';
   return '스킬 내용';
  }
 });
 assert.equal(directCalls,0);
 assert.deepEqual(calls.map(call=>call.tool),['skill','plugin_search','plugin_call']);
 assert.match(calls[1].text,/gmail/i);
});
test('a screenshot email uses one saved screen capture and never offers video recording',async()=>{
 const calls=[];let stage='start';
 const task={...spec,tools:['plugin_search','plugin_call'],steps:['화면 캡처 한 장 저장','내 이메일 주소 확인','캡처를 첨부해 이메일 한 통 발송']};
 const result=await runAgentLoop({
  input:'내 이메일로 테스트 이메일 하나 보내고 첨부파일로 스크린샷 하나 찍어 보내줘',
  settings:{computerUse:true,toolAllow:['look','record_screen','plugin_search','plugin_call']},
  context:{},maxSteps:8,
  chat:async(messages,format)=>{
   if(format.properties.kind)return JSON.stringify(task);
   const tools=format.properties.tool.enum;
   assert.ok(tools.includes('plugin_search'));
   assert.ok(tools.includes('plugin_call'));
   assert.ok(!tools.includes('record_screen'),'video recording is not a screenshot tool');
   if(stage==='start'){
    assert.ok(tools.includes('look'),'the user requested an attached screenshot');
    stage='captured';return JSON.stringify(act('look'));
   }
   if(stage==='captured'){
    assert.ok(!tools.includes('look'),'the one requested screenshot is already saved');
    assert.ok(messages.some(message=>message.role==='user'&&message.content.includes('캡처/화면-test.jpg')));
    stage='discovered';return JSON.stringify(act('plugin_search','gmail'));
   }
   if(stage==='discovered'){
    stage='profiled';return JSON.stringify({tool:'plugin_call',path:'gmail.get_profile',text:'{}',thought:'내 계정 주소 확인'});
   }
   if(stage==='profiled'){
    stage='sent';return JSON.stringify({tool:'plugin_call',path:'gmail.send_attached_email',text:JSON.stringify({
     to:'person@example.test',subject:'테스트 이메일',body:'요청하신 화면 캡처를 첨부합니다.',files:['캡처/화면-test.jpg']
    }),thought:'캡처를 첨부해 테스트 이메일 발송'});
   }
   return JSON.stringify(act('reply','테스트 이메일을 캡처 첨부와 함께 발송했습니다.'));
  },
  execute:async action=>{
   if(action.thought==='연결된 서비스 기능 확인')return [];
   calls.push(action);
   if(action.tool==='look')return {image:'aGVsbG8=',imageWidth:1,imageHeight:1,elements:[],window:{title:'현재 화면',process:'desktop'},capturePath:'캡처/화면-test.jpg'};
   if(action.tool==='plugin_search')return 'gmail.get_profile, gmail.send_attached_email';
   if(action.path==='gmail.get_profile')return 'person@example.test';
   if(action.path==='gmail.send_attached_email')return 'sent';
   return '';
  }
 });
 assert.equal(stage,'sent');
 assert.deepEqual(calls.map(call=>call.tool),['look','plugin_search','plugin_call','plugin_call']);
 assert.equal(JSON.parse(calls.at(-1).text).files[0],'캡처/화면-test.jpg');
 assert.equal(result.events.filter(event=>event.tool==='record_screen').length,0);
});
test('a screenshot sent to the user selects both Gmail attachment and computer capture guidance',()=>{
 const request='내 이메일로 테스트 이메일 하나 보내고 첨부파일로 스크린샷 하나 찍어 보내줘';
 const skills=[
  {name:'gmail-attachments',description:'Gmail 첨부파일을 보내거나 스크린샷을 캡처해 이메일에 첨부할 때 사용한다.'},
  {name:'computer-use:computer-use',description:'화면 캡처, Windows 조작, 명시적 동영상 녹화에 사용한다.'}
 ];
 assert.equal(desktopOperation(request),true);
 assert.deepEqual(relevantSkills(skills,request).map(skill=>skill.name),['computer-use:computer-use','gmail-attachments']);
});
test('a screenshot email never invokes a second Gmail send after its first attempt',async()=>{
 let sends=0,captured=false;
 await runAgentLoop({input:'스크린샷 이메일로 보내줘',settings:{noSpec:true,toolAllow:['look','plugin_call']},context:{},maxSteps:4,
  chat:async()=>JSON.stringify(captured?{tool:'plugin_call',path:'gmail.send_attached_email',text:'{"to":"me@example.test","files":["캡처/화면-test.jpg"]}',thought:'스크린샷 이메일 발송'}:act('look')),
  execute:async action=>{
   if(action.tool==='plugin_call'){sends++;return 'sent message id msg-1';}
   if(action.tool==='look'){captured=true;return {image:'aGVsbG8=',imageWidth:1,imageHeight:1,elements:[],window:{title:'현재 화면'},capturePath:'캡처/화면-test.jpg'};}
   return '';
  }});
 assert.equal(sends,1);
});
test('a screenshot email attaches the saved capture instead of a guessed path',async()=>{
 const sent=[];let looks=0;
 await runAgentLoop({input:'스크린샷 이메일로 보내줘',settings:{noSpec:true,toolAllow:['look','plugin_call']},context:{},maxSteps:3,
  chat:async()=>JSON.stringify({tool:'plugin_call',path:'gmail.send_attached_email',text:'{"to":"me@example.test","files":["캡처/화면-추측.jpg","screenshot.png"]}","path":"gmail.send_attached_email"}',thought:'스크린샷 이메일 발송'}),
  execute:async action=>{if(action.tool==='look'){looks++;return {image:'aGVsbG8=',imageWidth:1,imageHeight:1,elements:[],window:{title:'현재 화면'},capturePath:'캡처/화면-test.jpg'};}sent.push(action);return 'sent';}});
 assert.equal(looks,1);
 assert.equal(sent.length,1);
 assert.deepEqual(sent[0].files||JSON.parse(sent[0].text).files,['캡처/화면-test.jpg']);
});
test('a failed screenshot capture stops before Gmail discovery',async()=>{
 let looks=0,searches=0;
 const result=await runAgentLoop({input:'스크린샷 이메일로 보내줘',settings:{noSpec:true,toolAllow:['look','plugin_search','plugin_call']},context:{},maxSteps:8,
 chat:async()=>JSON.stringify(act('plugin_search','gmail')),
 execute:async action=>{
  if(action.tool==='look'){looks++;return {image:'aGVsbG8=',imageWidth:1,imageHeight:1,elements:[],window:{title:'현재 화면'}};}
  if(action.tool==='plugin_search'){searches++;return [];}
  return 'unexpected';
 }});
 assert.equal(looks,1);
 assert.equal(searches,0);
 assert.equal(result.complete,false);
});
test('a screenshot email does not capture again if the model repeats look',async()=>{
 let looks=0,sends=0,proposals=0;
 await runAgentLoop({input:'스크린샷 이메일로 보내줘',settings:{noSpec:true,toolAllow:['look','plugin_call']},context:{},maxSteps:4,
  chat:async()=>JSON.stringify(proposals++<2?act('look'):{
   tool:'plugin_call',path:'gmail.send_attached_email',
   text:'{"to":"me@example.test","files":["캡처/화면-test.jpg"]}',thought:'기존 캡처를 첨부해 발송'}),
  execute:async action=>{
   if(action.tool==='look'){looks++;return {image:'aGVsbG8=',imageWidth:1,imageHeight:1,elements:[],window:{title:'현재 화면'},capturePath:'캡처/화면-test.jpg'};}
   if(action.tool==='plugin_call'){sends++;return 'sent message id msg-1';}
   return '';
  }});
 assert.equal(looks,1);
 assert.equal(sends,1);
});
test('skill descriptions in Windows CRLF frontmatter remain available to routing',()=>{
 return import('../skills.mjs').then(({skillFrontmatter})=>{
  assert.equal(typeof skillFrontmatter,'function');
  assert.equal(skillFrontmatter('---\r\nname: doc-coauthoring\r\ndescription: Use for structured document writing.\r\n---\r\n# Guide').description,'Use for structured document writing.');
 });
});
test('a capability denial after discovery still reports the action as incomplete',async()=>{
 let searched=false;
 const result=await runAgentLoop({input:'메일 보내줘',settings:{noSpec:true,toolAllow:['plugin_search']},context:{},maxSteps:5,
  chat:async()=>JSON.stringify(searched?act('reply','저는 텍스트 기반 언어 모델입니다.'):act('plugin_search','gmail')),
  execute:async()=>{searched=true;return '서비스 연결 없음';}});
 assert.equal(result.complete,false);
});

test('capture receipt keeps absolute and relative paths and accepts an equivalent attachment',async()=>{
 const root='C:\\workspace', relative='캡처/화면-test.jpg', absolute='C:\\workspace\\캡처\\화면-test.jpg';
 let captured=false,sends=0,saveRequested=false,seen='';
 const result=await runAgentLoop({input:'스크린샷 이메일로 보내줘',settings:{noSpec:true,toolAllow:['look','plugin_call']},context:{root},maxSteps:5,
 chat:async messages=>{seen+=messages.map(m=>m.content).join('\n');return JSON.stringify(captured?{tool:'plugin_call',path:'gmail.send_attached_email',text:JSON.stringify({to:'me',subject:'test',body:'test',files:[absolute]})}:act('look'));},
 execute:async action=>{if(action.tool==='look'){captured=true;saveRequested=action.saveCapture===true;return {image:'fixture',elements:[],window:{title:'desktop'},capturePath:relative};}sends++;assert.deepEqual(JSON.parse(action.text).files,[relative]);return 'sent id 1';}});
 assert.equal(saveRequested,true);
 assert.equal(sends,1);
 const event=result.events.find(e=>e.tool==='look');
 assert.equal(event.capturePath,absolute);
 assert.equal(event.relativeCapturePath,relative);
 assert.ok(event.observation.includes(absolute));
 assert.ok(seen.includes('Saved screenshot file (full path): '+absolute));
});

test('blocked capture reports the block instead of claiming the path is missing',async()=>{
 const result=await runAgentLoop({input:'스크린샷 이메일로 보내줘',settings:{noSpec:true,toolAllow:['look']},context:{},maxSteps:2,
 chat:async()=>JSON.stringify(act('look')),execute:async()=>({blocked:true,ok:false,capturePath:'캡처/existing.jpg',reason:'target changed'})});
 assert.doesNotMatch(result.answer,/경로를 확인하지 못해/);
 assert.match(result.answer,/차단|실패/);
});

test('a saved screenshot remains usable when UI inspection is blocked',async()=>{
 const calls=[];let stage=0;
 const send={name:'gmail.send_attached_email',description:'첨부파일 이메일 발송',inputSchema:{type:'object',properties:{files:{type:'array'}},required:['files']}};
 const result=await runAgentLoop({input:'스크린샷 이메일 발송',settings:{noSpec:true,toolAllow:['look','plugin_search','plugin_call']},context:{},maxSteps:8,
  chat:async()=>{
   if(stage++===0)return JSON.stringify(act('look'));
   if(stage===2)return JSON.stringify(act('plugin_search','gmail'));
   if(stage===3)return JSON.stringify({tool:'plugin_call',path:'gmail.send_attached_email',text:'{"to":"me@example.test","files":["캡처/화면-test.jpg"]}',thought:'저장한 화면 첨부 발송'});
   return JSON.stringify(act('reply','캡처를 첨부해 이메일을 발송했습니다.'));
  },
  execute:async action=>{
   calls.push(action);
   if(action.tool==='look')return {ok:false,blocked:true,image:'aGVsbG8=',imageWidth:1,imageHeight:1,elements:[],window:{title:'보호된 창'},capturePath:'캡처/화면-test.jpg'};
   if(action.tool==='plugin_search')return [send];
   return 'sent id 123';
  }});
 const look=result.events.find(event=>event.tool==='look');
 assert.deepEqual(calls.map(call=>call.tool),['look','plugin_search','plugin_call']);
 assert.equal(JSON.parse(calls.at(-1).text).files[0],'캡처/화면-test.jpg');
 assert.equal(look.ok,true);
 assert.ok(result.artifacts.includes(look.capturePath));
});
test('a successful Gmail send ends the task at once with a short receipt',async()=>{
 const calls=[];let captured=false;
 const result=await runAgentLoop({input:'스크린샷 이메일로 보내줘',settings:{noSpec:true,toolAllow:['look','plugin_call']},context:{},maxSteps:8,
  chat:async()=>JSON.stringify(captured?{tool:'plugin_call',path:'gmail.send_attached_email',text:'{"to":"me","subject":"테스트","body":"테스트 메일","files":["캡처/화면-test.jpg"]}',thought:'캡처 후 발송'}:act('look')),
  execute:async action=>{calls.push(action.tool);if(action.tool==='look'){captured=true;return {image:'aGVsbG8=',imageWidth:1,imageHeight:1,elements:[],window:{title:'현재 화면'},capturePath:'캡처/화면-test.jpg'};}
   return JSON.stringify({status:'발송 후 첨부 확인 완료',message_id:'abc',to:'me',subject:'테스트',attachments:['화면-test.jpg']});}});
 assert.equal(calls.filter(t=>t==='plugin_call').length,1);
 assert.equal(result.complete,true);
 assert.match(result.answer,/^메일을 보냈습니다\./);
 assert.match(result.answer,/첨부: 화면-test\.jpg/);
});
test('a repeated send after a confirmed receipt ends as complete, not as needing input',async()=>{
 let sends=0,captured=false;
 const result=await runAgentLoop({input:'스크린샷 이메일로 보내줘',settings:{noSpec:true,toolAllow:['look','plugin_call']},context:{},maxSteps:5,
  chat:async()=>JSON.stringify(captured?{tool:'plugin_call',path:'gmail.send_attached_email',text:'{"to":"me","files":["캡처/화면-test.jpg"]}',thought:'발송'}:act('look')),
  execute:async action=>{if(action.tool==='look'){captured=true;return {image:'aGVsbG8=',imageWidth:1,imageHeight:1,elements:[],window:{title:'현재 화면'},capturePath:'캡처/화면-test.jpg'};}
   sends++;return JSON.stringify({status:'발송 후 첨부 확인 완료',message_id:'abc'});}});
 assert.equal(sends,1);
 assert.equal(result.complete,true);
 assert.notEqual(result.needsInput,true);
});

// 2026-11-20: "스크린샷 테스트 메일로 보내줘" + mid-task "내 유튜브 링크도 첨부해". The first mail went out, the agent asked for the
// link, the user answered "채널 이름으로 찾아봐", and the follow-up mail with the link was blocked as a duplicate send.
const shot={image:'aGVsbG8=',imageWidth:1,imageHeight:1,elements:[],window:{title:'현재 화면'},capturePath:'캡처/화면-test.jpg'};
const sendText=(subject,body)=>JSON.stringify({to:'me',subject,body,files:['캡처/화면-test.jpg']});
async function followUpRun({answerUser=true,secondText=sendText('테스트 이메일 (유튜브 링크 포함)','유튜브: https://www.youtube.com/channel/UCxyz')}={}){
 const sent=[];let captured=false,asked=false,turn=0;
 const result=await runAgentLoop({input:'스크린샷 테스트 이메일로 보내주고 내 유튜브 링크도 넣어줘',settings:{noSpec:true,toolAllow:['look','plugin_call','reply']},maxSteps:10,
  context:{askUser:async()=>{asked=true;return answerUser?'채널 이름으로 찾아봐':'작업 중지';}},
  chat:async(messages,schema)=>{
   if(schema?.properties?.verified)return JSON.stringify({verified:true,quote:'',gap:''});
   if(!captured)return JSON.stringify(act('look'));
   if(!sent.length)return JSON.stringify({tool:'plugin_call',path:'gmail.send_attached_email',text:sendText('테스트 이메일','스크린샷입니다.'),thought:'발송'});
   if(!asked)return JSON.stringify({tool:'reply',text:'유튜브 링크를 알려 주시겠어요?',path:'',needsInput:true,thought:'링크 질문'});
   if(sent.length===1 && turn++===0)return JSON.stringify({tool:'plugin_call',path:'gmail.send_attached_email',text:secondText,thought:'링크 포함 후속 메일'});
   return JSON.stringify({tool:'reply',text:'링크를 넣은 메일도 보냈습니다.',path:'',thought:'보고'});
  },
  execute:async action=>{
   if(action.tool==='look'){captured=true;return shot;}
   sent.push(action.text);return JSON.stringify({status:'발송 후 첨부 확인 완료',message_id:'m'+sent.length,to:'me',attachments:['화면-test.jpg']});
  }});
 return {sent,result,asked};
}
test('a follow-up mail requested by the user after the first send is sent once',async()=>{
 const {sent,asked}=await followUpRun();
 assert.equal(asked,true);
 assert.equal(sent.length,2,'the link mail must go out after the user answered');
 assert.match(sent[1],/youtube\.com/);
});
test('an identical resend is still blocked even after new user input',async()=>{
 const {sent}=await followUpRun({secondText:sendText('테스트 이메일','스크린샷입니다.')});
 assert.equal(sent.length,1);
});
