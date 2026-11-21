import assert from 'node:assert/strict';
import test from 'node:test';
import {runAgentLoop,serviceQueryFor} from '../agent-loop.mjs';
import {isLoginPage} from '../research.mjs';

const loginError=()=>Object.assign(Error('로그인이 필요한 개인 페이지입니다: https://calendar.google.com/calendar/u/0/r — web_read는 로그인 상태를 쓸 수 없어 사용자가 로그인해도 읽지 못합니다.'),
  {code:'LOGIN_REQUIRED',url:'https://calendar.google.com/calendar/u/0/r'});

test('login pages and service hints are recognized',()=>{
  assert.ok(isLoginPage(new URL('https://accounts.google.com/ServiceLogin?service=cl')));
  assert.ok(isLoginPage(new URL('https://example.com/user/login')));
  assert.ok(!isLoginPage(new URL('https://github.com/anthropics')));
  assert.equal(serviceQueryFor('https://calendar.google.com/calendar/u/0/r'),'calendar');
  assert.equal(serviceQueryFor('https://example.com/'),'');
});

test('a login wall on web_read goes to the connected service instead of asking the user to log in',async()=>{
  const calls=[];let asked=0,turn=0;
  await runAgentLoop({
    input:'구글 캘린더 일정 5개를 말해줘',
    settings:{noSpec:true,toolAllow:['web_read','plugin_search','user_action']},
    context:{askUser:async()=>{asked++;return '완료했어요';}},
    maxSteps:6,
    chat:async(messages,format)=>{
      if(format?.properties?.verified)return JSON.stringify({verified:true,quote:'',gap:''});
      const steps=[{tool:'web_read',text:'https://calendar.google.com/',path:'',thought:''},
        {tool:'user_action',text:'구글 캘린더 페이지에서 로그인을 완료해 주세요.',path:'',thought:''},
        {tool:'reply',text:'일정을 확인했습니다.',path:'',thought:''}];
      return JSON.stringify(steps[Math.min(turn++,steps.length-1)]);
    },
    execute:async action=>{calls.push(action.tool+':'+(action.text||''));if(action.tool==='web_read')throw loginError();return '[]';}
  });
  assert.ok(calls.includes('plugin_search:calendar'),calls.join(' | '));
  assert.equal(asked,0);
});

test('with the work browser available, a login request opens the page in the browser window',async()=>{
  const calls=[];let asked=0,turn=0;
  await runAgentLoop({
    input:'example.com 회원 페이지 내용을 읽어 줘',
    settings:{noSpec:true,privateBrowser:true,toolAllow:['web_read','browser_open']},
    context:{askUser:async()=>{asked++;return '완료했어요';}},
    maxSteps:6,
    chat:async(messages,format)=>{
      if(format?.properties?.verified)return JSON.stringify({verified:true,quote:'',gap:''});
      const steps=[{tool:'web_read',text:'https://example.com/member',path:'',thought:''},
        {tool:'reply',text:'읽었습니다.',path:'',thought:''}];
      return JSON.stringify(steps[Math.min(turn++,steps.length-1)]);
    },
    execute:async action=>{
      calls.push(action.tool+':'+(action.text||''));
      if(action.tool==='web_read')throw Object.assign(Error('로그인이 필요한 개인 페이지입니다: https://example.com/member'),{code:'LOGIN_REQUIRED',url:'https://example.com/member'});
      return '주소: https://example.com/member\n본문 일부:\n회원 정보';
    }
  });
  assert.ok(calls.includes('browser_open:https://example.com/member'),calls.join(' | '));
  assert.equal(asked,0);
});
