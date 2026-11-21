import test from 'node:test';
import assert from 'node:assert/strict';
import {runAgentLoop} from '../agent-loop.mjs';

for(const interleave of [false,true])test(`changing failed routes stop without progress (skill interleave=${interleave})`,async()=>{
  let failures=0,turn=0;
  const result=await runAgentLoop({input:'파일 내용을 확인해 줘',maxSteps:40,
    settings:{noSpec:true,subagent:true,computerUse:false},context:{},
    chat:async(_m,f)=>{
      if(f.properties.verified)return JSON.stringify({verified:false,quote:'',gap:'없음'});
      turn++;
      const skill=interleave && turn%2===0;
      return JSON.stringify({tool:skill?'skill':'read',text:skill?'guide':'',path:skill?'':`missing-${turn}-${failures}.txt`});
    },execute:async a=>{if(a.tool==='skill')return '사용법 안내';failures++;throw Error('파일 없음');}});
  assert.ok(failures<=10,`failed executions=${failures}`);
  assert.equal(result.complete,false);
  assert.match(result.answer,/진전|실패|오류/);
});

// 2026-11-14 정리: 녹화 도구(record_screen)는 녹화를 요청했을 때만 보입니다(스크린샷과 헷갈리지 않게).
// 그래서 일반 요청에서는 화면 캡처 계약만, 녹화 요청에서는 녹화 계약도 들어 있는지 확인합니다.
const recoveryContracts=async input=>{
  let observed='';
  await runAgentLoop({input,maxSteps:2,settings:{noSpec:true,computerUse:true},context:{},
    chat:async(m,f)=>{
      if(f.properties.tool?.enum.includes('ask_user')){
        observed=m[0].content;
        return JSON.stringify({tool:'blocked',text:'파일이 없습니다.'});
      }
      return JSON.stringify({tool:'read',path:'missing.txt',text:''});
    },execute:async()=>{throw Error('파일 없음');}});
  return observed;
};
test('recovery receives real tool contracts instead of names alone',async()=>{
  const observed=await recoveryContracts('파일 읽어 줘');
  assert.match(observed,/capturePath/);
  assert.match(observed,/read: 파일 읽기\. path=/);
  assert.doesNotMatch(observed,/\nrecord_screen:/);
});

for(const bad of [
  {tool:'record_screen',text:'screenshot.png'},
  {tool:'plugin_call',text:'computer-use'},
  {tool:'plugin_call',path:'example.tool',text:'not json'},
  {tool:'skill',text:'computer-use:computer-use:look'},
])test(`invalid ${bad.tool} arguments are rejected before dispatch: ${bad.text}`,async()=>{
  const calls=[];let turn=0;
  await runAgentLoop({input:'화면 스크린샷 저장',maxSteps:4,
    settings:{noSpec:true,computerUse:true,skills:[{name:'computer-use:computer-use',description:'화면 조작'}]},context:{},
    chat:async(_m,f)=>{
      if(f.properties.tool?.enum.includes('ask_user'))return JSON.stringify({tool:'blocked',text:'테스트 종료'});
      if(f.properties.verified)return JSON.stringify({verified:false,quote:'',gap:''});
      return JSON.stringify(turn++?{tool:'reply',text:'작업을 완료하지 못했습니다.'}:bad);
    },execute:async a=>{calls.push(a);throw Error('invalid call reached executor');}});
  // 2026-11-14 정리: 요청에 맞는 스킬 설명서는 앱이 먼저 자동으로 읽고(skill), 잘못된 도구 이름은 실제 도구로 바로잡습니다.
  // 확인할 것은 "잘못된 인자 그대로" 실행기에 닿지 않는 것입니다.
  assert.ok(!calls.some(a=>a.tool===bad.tool && String(a.text??'')===String(bad.text??'') && String(a.path??'')===String(bad.path??'')),calls.map(a=>a.tool+':'+(a.text||'')).join(','));
});

test('new successful observations allow recovery beyond ten total failures',async()=>{
  let calls=0;
  const result=await runAgentLoop({input:'파일 내용 확인',maxSteps:30,settings:{noSpec:true,subagent:true,computerUse:false},context:{},
    chat:async(_m,f)=>JSON.stringify(f.properties.verified?{verified:true,quote:'확인된 본문 20',gap:''}:
      calls>=20?{tool:'reply',text:'확인된 본문 20'}:{tool:'read',path:`file-${calls}.txt`,text:''}),
    execute:async()=>{calls++;if(calls%10)throw Error('일시 오류');return `확인된 본문 ${calls}`;}});
  assert.equal(calls,20);
  assert.equal(result.complete,true);
});

test('repeated identical successful observations do not erase failed work',async()=>{
  let calls=0,failures=0;
  await runAgentLoop({input:'파일 내용 확인',maxSteps:50,settings:{noSpec:true,subagent:true,computerUse:false},context:{},
    chat:async()=>JSON.stringify({tool:'read',path:`file-${calls}.txt`,text:''}),
    execute:async()=>{calls++;if(calls%2){failures++;throw Error('오류');}return '같은 목록';}});
  assert.ok(failures<=11,`failures=${failures}`);
});

test('a screenshot request does not offer video recording and captures directly',async()=>{
  const calls=[];let proposed=false;
  const result=await runAgentLoop({input:'화면 스크린샷 저장',maxSteps:8,settings:{noSpec:true,computerUse:true},context:{},
    chat:async(_m,f)=>{
      if(f.properties.verified)return JSON.stringify({verified:true,quote:'캡처/화면-test.jpg',gap:''});
      assert.ok(!f.properties.tool.enum.includes('record_screen'));
      if(!proposed){proposed=true;return JSON.stringify({tool:'look',text:'',path:''});}
      return JSON.stringify({tool:'reply',text:'캡처/화면-test.jpg에 저장했습니다.'});
    },execute:async a=>{calls.push(a.tool);return {ok:true,capturePath:'캡처/화면-test.jpg',image:'fixture',imageWidth:100,imageHeight:100,elements:[],texts:[],window:{title:'테스트 화면',process:'fixture'}};}});
  assert.deepEqual(calls,['look']);
  assert.equal(result.complete,true,result.answer);
  assert.deepEqual(result.artifacts,['캡처/화면-test.jpg']);
});

test('identical reads stop after recovery fails to find new evidence',async()=>{
  let calls=0;
  const result=await runAgentLoop({input:'파일 내용을 확인해 줘',maxSteps:12,settings:{noSpec:true,subagent:true,computerUse:false},context:{},
    chat:async(_m,f)=>JSON.stringify(f.properties.tool?.enum.includes('ask_user')?{tool:'blocked',text:'다른 경로 없음'}:{tool:'read',path:'same.txt',text:''}),
    execute:async()=>{calls++;return 'unchanged content';}});
  assert.ok(calls<=4,`unchanged reads=${calls}`);
  assert.equal(result.complete,false);
});

test('malformed action JSON is bounded before tool dispatch',async()=>{
  let calls=0;
  const result=await runAgentLoop({input:'파일 내용을 확인해 줘',maxSteps:12,settings:{noSpec:true,subagent:true,computerUse:false},context:{},
    chat:async()=>{calls++;return '{invalid';},execute:async()=>{throw Error('must not execute');}});
  assert.ok(calls<=3,`malformed generations=${calls}`);
  assert.equal(result.complete,false);
});

test('a single-backslash Windows path in service input is repaired and the call runs without rediscovery',async()=>{
  let feedback=''; let turn=0; const called=[];
  await runAgentLoop({input:'연결된 서비스의 파일 정보를 확인해 줘',maxSteps:8,settings:{noSpec:true,computerUse:false},context:{},
    chat:async(m,f)=>{
      feedback+=m.map(x=>x.content).join('\n');
      if(f.properties.tool?.enum.includes('ask_user'))return JSON.stringify({tool:'blocked',text:'없음'});
      return JSON.stringify(turn++===0?{tool:'plugin_search',text:'files'}:{tool:'plugin_call',path:'files.info',text:String.raw`{"path":"C:\work\image.png"}`});
    },execute:async action=>{if(action.tool==='plugin_call')called.push(JSON.parse(action.text).path);return JSON.stringify([{name:'files.info',inputSchema:{type:'object',properties:{path:{type:'string'}}}}]);}});
  // 역슬래시를 하나만 쓴 윈도우 경로는 이제 오류로 돌려보내지 않고 바로잡아 그대로 실행합니다.
  assert.equal(called[0],String.raw`C:\work\image.png`);
});
