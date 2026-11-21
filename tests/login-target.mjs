import assert from 'node:assert/strict';
import test from 'node:test';
import {runAgentLoop} from '../agent-loop.mjs';

const run=async({steps,execute,input='한빛대학교 비교과 프로그램 참여 현황 알려줘',toolAllow=['web_search','web_read','user_action']})=>{
  const cards=[],calls=[];let turn=0;
  const result=await runAgentLoop({
    input,settings:{noSpec:true,toolAllow},maxSteps:8,
    context:{askUser:async card=>{cards.push(card);return '완료했어요';}},
    chat:async(messages,format)=>{
      if(format?.properties?.verified)return JSON.stringify({verified:true,quote:'',gap:''});
      return JSON.stringify(steps[Math.min(turn++,steps.length-1)]);
    },
    execute:async action=>{calls.push(action.tool+':'+(action.text||''));return execute?.(action)??'[]';}
  });
  return {result,cards,calls};
};

test('a login request with nothing to show never pops a blind card',async()=>{
  const {cards,calls}=await run({steps:[
    {tool:'user_action',text:'해당 사이트에 로그인해 주세요.',path:'',thought:''},
    {tool:'reply',text:'공개된 정보로는 참여 현황을 확인하지 못했습니다.',path:'',thought:''}]});
  assert.equal(cards.length,0);
  assert.ok(!calls.some(c=>c.startsWith('show_page')),calls.join(' | '));
});

test('a login wall turns on the visible work browser for this task even for the local model',async()=>{
  const {cards,calls}=await run({
    input:'하늘누리 참여 현황 알려줘 https://program.example.ac.kr/my',
    toolAllow:[],
    steps:[{tool:'web_read',text:'https://program.example.ac.kr/my',path:'',thought:''},{tool:'reply',text:'확인했습니다.',path:'',thought:''}],
    execute:action=>{
      if(action.tool==='web_read')throw Object.assign(Error('로그인이 필요한 개인 페이지입니다: https://program.example.ac.kr/my'),{code:'LOGIN_REQUIRED',url:'https://program.example.ac.kr/my'});
      return '주소: https://program.example.ac.kr/my\n본문 일부:\n참여 현황';
    }});
  assert.ok(calls.includes('browser_open:https://program.example.ac.kr/my'),calls.join(' | '));
  assert.equal(cards.length,0);
});

test('a web task gives the local model the user browser without any site-specific setting',async()=>{
  const calls=[];let turn=0;
  await runAgentLoop({input:'학교 포털에서 내 비교과 참여 현황 알려줘',maxSteps:5,settings:{},context:{},
    chat:async(messages,schema)=>{
      if(schema?.properties?.kind)return JSON.stringify({kind:'action',access:'observe',surface:'web',goal:'참여 현황 확인',steps:['포털 열기','현황 읽기'],tools:['web_search','browser_open'],criteria:['참여 현황'],missing:''});
      if(schema?.properties?.verified)return JSON.stringify({verified:true,quote:'',gap:''});
      if(schema?.properties?.checks)return JSON.stringify({checks:[],missing:'',stages:[]});
      return JSON.stringify(turn++===0?{tool:'browser_open',text:'https://portal.example.ac.kr/',path:'',thought:''}:{tool:'reply',text:'확인했습니다.',path:'',thought:''});
    },
    execute:async a=>{calls.push(a.tool);return '주소: https://portal.example.ac.kr/\n본문 일부:\n참여 현황';}});
  assert.ok(calls.includes('browser_open'),calls.join(' | '));
});

test('a built-in capability named as external never sends the agent to a third-party tool site',async()=>{
  const calls=[];let turn=0;
  await runAgentLoop({input:'한빛대 비교과포털 비교과 프로그램 참여현황 알려줘',maxSteps:4,settings:{},context:{},
    chat:async(messages,schema)=>{
      if(schema?.properties?.kind)return JSON.stringify({kind:'action',access:'observe',surface:'web',goal:'참여 현황',externalCapability:'web_search',steps:['검색','답변'],tools:['web_search'],criteria:['참여 현황'],missing:''});
      if(schema?.properties?.verified)return JSON.stringify({verified:true,quote:'',gap:''});
      if(schema?.properties?.checks)return JSON.stringify({checks:[],missing:'',stages:[]});
      return JSON.stringify(turn++===0?{tool:'web_search',text:'한빛대 비교과포털',path:'',thought:''}:{tool:'reply',text:'확인했습니다.',path:'',thought:''});
    },
    execute:async a=>{calls.push(a.tool);return '[]';}});
  assert.ok(!calls.includes('find_free_tool'),calls.join(' | '));
});

test('a login request after reading a page opens that page in the browser first',async()=>{
  const {cards,calls}=await run({steps:[
    {tool:'web_read',text:'https://www.hanbit.example.ac.kr/eduprogram',path:'',thought:''},
    {tool:'user_action',text:'사이트에 로그인해 주세요.',path:'',thought:''},
    {tool:'reply',text:'확인했습니다.',path:'',thought:''}]});
  assert.ok(calls.includes('show_page:https://www.hanbit.example.ac.kr/eduprogram'),calls.join(' | '));
  assert.equal(cards.length,1);
  assert.match(cards[0].question,/브라우저 새 창에 www\.hanbit\.example\.ac\.kr/);
});

test('once a page is open in the background tab, screen tools never act on the user’s window',async()=>{
  // 웹으로 분류되지 않은 후속 요청("ㄱ")에서도, 이번 작업에 브라우저 탭을 쓴 뒤라면 화면 도구 대신 브라우저 도구로 바꿉니다.
  const calls=[];let turn=0;
  await runAgentLoop({input:'장바구니 비우기 계속해',maxSteps:8,settings:{noSpec:true,brain:'mixed',toolAllow:['browser_open','browser_read','open_url','click','look','focus']},context:{},
    chat:async(messages,schema)=>{
      if(schema?.properties?.verified)return JSON.stringify({verified:true,quote:'',gap:''});
      if(schema?.properties?.checks)return JSON.stringify({checks:[],missing:'',stages:[]});
      const steps=[{tool:'browser_open',text:'https://shop.example.com/cart',path:'',thought:''},{tool:'open_url',text:'https://shop.example.com/cart',path:'',thought:''},{tool:'focus',text:'Chrome',path:'',thought:''},{tool:'click',text:'3',path:'',thought:''},{tool:'reply',text:'확인했습니다.',path:'',thought:''}];
      return JSON.stringify(steps[Math.min(turn++,steps.length-1)]);
    },
    execute:async a=>{calls.push(a.tool);return '주소: https://shop.example.com/cart\n본문 일부:\n장바구니';}});
  assert.ok(calls.includes('browser_open'),calls.join(' | '));
  assert.ok(!calls.some(t=>['open_url','click','look','focus'].includes(t)),calls.join(' | '));
});
