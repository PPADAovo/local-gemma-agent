import assert from 'node:assert/strict';
import test from 'node:test';
import {runAgentLoop} from '../agent-loop.mjs';

const action=(tool,text,more={})=>({tool,text,thought:'검증',...more});
const plan=action('plan','파일 목록 확인\n메모 확인');
const list=action('list','');
const read=action('read','',{path:'메모.txt'});
const check=number=>action('check',String(number));

async function run(actions,execute=async()=> '확인한 결과',progress=()=>{}){
  return runAgentLoop({
    input:'메모를 찾아서 읽어 줘',settings:{noSpec:true,computerUse:false},context:{},
    maxSteps:actions.length,progress,
    chat:async()=>JSON.stringify(actions.shift()),execute
  });
}

test('repeated continuation questions cannot end an unfinished plan; actual results complete it',async()=>{
  const followup=action('reply','다음 단계로 진행할까요?',{needsInput:true});
  const called=[];
  const result=await run([plan,check(1),list,check(1),followup,followup,followup,followup,read,check(2),action('reply','메모에 회의라고 적혀 있습니다.'),{verified:true,quote:'회의',gap:''}],
    async step=>{called.push(step.tool);return step.tool==='list'?'메모.txt':'회의';});
  assert.deepEqual(called,['list','read']);
  assert.equal(result.events.find(event=>event.tool==='check').ok,false);
  assert.match(result.answer,/회의/);
  assert.equal(result.complete,true);
  assert.doesNotMatch(result.answer,/진행할까요|⬜/);
});

test('a specific question about missing input can end the turn with pending steps',async()=>{
  const prompt='같은 이름의 파일이 두 개입니다. 어느 폴더의 메모를 읽을까요?';
  const progress=[];
  const result=await run([plan,list,check(1),action('reply',prompt,{needsInput:true})],undefined,line=>progress.push(line));
  assert.ok(result.answer.startsWith(prompt));
  assert.equal(result.complete,false);
  assert.match(progress.join('\n'),/⬜ 메모 확인/);
});

test('when the model keeps reporting completion without doing the work the limit reports an unfinished task',async()=>{
  const bogus=action('reply','할 일을 전부 끝냈습니다.');
  const result=await run([plan,bogus,bogus,bogus,bogus,bogus]);
  assert.match(result.answer,/끝내지 못/);
  assert.equal(result.complete,false);
  assert.doesNotMatch(result.answer,/전부 끝냈습니다/);
});

test('a written deliverable is checked against excerpts in chat without file or desktop actions',async()=>{
  const draft='안녕하세요. 수업 자료를 보내 주셔서 고맙습니다.';
  const full=draft+'\n\n다음 모임에서 다시 뵙겠습니다.';
  const outputs=[
    action('plan','감사 인사\n다음 만남 언급'),action('check','1'),
    action('write','임시 파일',{path:'letter.txt'}),
    action('reply',draft),{evidence:['고맙습니다.','다음 모임']},
    action('reply',full),{evidence:['고맙습니다.','다음 모임']}
  ];
  const result=await runAgentLoop({
    input:'감사 편지를 채팅에 써 줘',settings:{noSpec:true},context:{},maxSteps:6,
    chat:async()=>JSON.stringify(outputs.shift()),
    execute:async()=>assert.fail('Writing in chat executed an external action')
  });
  assert.ok(result.answer.startsWith(full));
  assert.equal(result.complete,true);
  assert(!result.answer.includes('⬜'));
});

test('a short chat writing request accepts the actual letter, not a claim it has been written',async()=>{
  const full='편지를 작성했습니다.\n\n할머니께, 보내 주신 사과 덕분에 아침 식탁이 풍성해졌어요. 사랑해요.';
  const outputs=[action('reply','편지를 작성했습니다.'),action('reply',full)];
  const result=await runAgentLoop({
    input:'할머니께 감사 편지를 써 줘',settings:{noSpec:true},context:{},maxSteps:2,
    chat:async()=>JSON.stringify(outputs.shift()),execute:async()=>assert.fail('Unexpected action')
  });
  assert.equal(result.answer,full);
  assert.equal(result.complete,true);
});

test('confirmed launch survives replan and an unchanged browser loop stops at the pending step',async()=>{
  const page='페이지: 스토어\n주소: https://example.test/store\n\nB1 [input:text] 검색';
  // 2026-11-14 정리: 브라우저 작업은 개인 브라우저 모드에서 자체 브라우저로 하므로, 앱 실행(open_app) 대신 페이지 열기가 첫 단계입니다.
  const choices=[action('plan','스토어 열기\n스토어에서 검색 결과 확인'),
    action('browser_open','https://example.test/store'),action('plan','스토어에서 검색 결과 확인')];
  const called=[],progress=[];
  const result=await runAgentLoop({
    input:'브라우저를 열고 스토어 항목을 검색해 줘',settings:{noSpec:true,computerUse:false,privateBrowser:true},context:{},maxSteps:25,
    chat:async (messages,schema)=>{
      if(schema.properties.quote){
        const {tool}=JSON.parse(messages.at(-1).content);
        return JSON.stringify({quote:tool==='browser_open'?'페이지: 스토어':''});
      }
      return JSON.stringify(choices.shift()||action('browser_key','enter'));
    },
    execute:async step=>{
      called.push(step.tool);
      if(step.tool==='open_app')return 'Chrome 새 창을 열고 확인했습니다.';
      if(step.tool==='browser_key')return '키: Enter\n'+page;
      return page;
    },progress:message=>progress.push(message)
  });
  assert.equal(result.complete,false);
  assert.match(progress.join('\n'),/✅ 스토어 열기/);
  assert.match(progress.join('\n'),/⬜ 스토어에서 검색 결과 확인/);
  assert.match(result.answer,/같은 페이지/);
  assert.equal(called.filter(t=>t==='browser_key').length,2);
  assert.ok(called.includes('browser_read'));
  assert.ok(progress.includes('확인 완료: 스토어 열기'));
});

test('a Chrome Web Store install click hands native permission review to the user',async()=>{
  const page='페이지: 테스트 확장 프로그램\n주소: https://chromewebstore.google.com/detail/example\nB2 [button] Chrome에 추가';
  const calls=[];
  const actions=[action('browser_open','https://chromewebstore.google.com/detail/example'),action('browser_click','B2')];
  const result=await runAgentLoop({input:'확장 프로그램 설치해 줘',settings:{noSpec:true,privateBrowser:true},context:{},maxSteps:5,
    chat:async()=>JSON.stringify(actions.shift()),execute:async step=>{
      calls.push(step.tool);
      return step.tool==='browser_open'?page:'클릭: B2 Chrome에 추가\n\n'+page;
    }});
  assert.deepEqual(calls,['browser_open','browser_click']);
  assert.equal(result.complete,false);
  assert.match(result.answer,/요청 권한/);
});
test('a repeated pending plan yields to action without dropping remaining work, then observations allow a replan', async()=>{
  const decisions=[
    action('plan','목록 확인\n문서 읽기\n합계 확인'),
    action('plan','문서 읽기\n합계 확인'),
    action('list',''),
    action('plan','원본 확인\n새 합계 확인'),
    action('reply','같은 이름의 파일이 두 개입니다. 어느 폴더인가요?',{needsInput:true})
  ];
  const menus=[],progress=[];
  const result=await runAgentLoop({input:'문서를 조회해 줘',settings:{noSpec:true},context:{},maxSteps:8,progress:line=>progress.push(line),
    chat:async(_messages,schema)=>{menus.push(schema.properties.tool.enum);return JSON.stringify(decisions.shift());},
    execute:async step=>{assert.equal(step.tool,'list');return '폴더 하나, 폴더 둘';}});
  assert(!menus[2].includes('plan'),'duplicate pending work should not offer plan again');
  assert(menus[2].includes('check')&&menus[2].includes('list'));
  assert(menus[3].includes('plan'),'a fresh observation must allow a revised plan');
  assert.equal(result.events.filter(e=>e.tool==='plan'&&e.ok).length,2);
  assert.match(progress.join('\n'),/새 합계 확인/);
});
