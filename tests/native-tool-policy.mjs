import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {runSimpleLoop} from '../simple-loop.mjs';
const call=(name,args={})=>({tool_calls:[{function:{name,arguments:args}}]});
const names=tools=>tools.map(t=>t.function.name);
async function attempt(settings,message){
  const actions=[];let external=0,step=0;
  const result=await runSimpleLoop({input:'프로필의 허용된 도구로 작업',settings,maxSteps:3,context:{requestExternalAssistance:async()=>{external++;return true;}},chatMessage:async()=>step++?{content:'작업을 완료했습니다.'}:message,execute:async a=>{actions.push(a.tool);return 'ok';}});
  assert.equal(result.complete,false);assert.equal(external,0);return actions;
}
test('native tool advertisements honor an explicit profile and internal aliases',async()=>{
  await runSimpleLoop({input:'상태 확인',settings:{toolAllow:['read','plugin_search']},execute:async()=>assert.fail(),chatMessage:async({tools})=>{
    assert.deepEqual(names(tools).sort(),['read','read_tool_result','service_search']);return {content:'사용 가능한 도구를 확인했습니다.'};
  }});
});
test('hallucinated native calls cannot bypass profiles or disabled capabilities',async()=>{
  for(const [settings,message] of [
    [{toolAllow:['read']},call('write',{path:'x.txt',content:'x'})],
    [{computerUse:false},call('look')],
    [{computerUse:false},call('browser_open',{url:'https://example.test'})],
    [{readOnly:true},call('run',{command:'anything'})],
    [{readOnly:true},call('service_call',{name:'mail.send',args:{}})],
    [{webMode:'off'},call('web_search',{query:'test'})],
    [{webEnabled:false},call('browser_read')],
    [{pluginsDisabled:true},call('service_search',{query:'mail'})],
    [{toolAllow:['click','look']},call('click',{target:'E1',double:true})],
    [{toolAllow:['windows']},call('windows',{text:'HWND:123'})]
  ])assert.deepEqual(await attempt(settings,message),[],JSON.stringify(settings));
});
test('read-only advertises observation tools but does not disable ordinary web browsing by mode',async()=>{
  await runSimpleLoop({input:'상태 확인',settings:{readOnly:true},execute:async()=>assert.fail(),chatMessage:async({tools})=>{
    const n=names(tools);for(const allowed of ['look','read','browser_read','service_search'])assert.ok(n.includes(allowed));
    for(const denied of ['type','write','edit','run','browser_open','service_call','user_action'])assert.ok(!n.includes(denied),denied);
    return {content:'확인했습니다.'};
  }});
  await runSimpleLoop({input:'웹 작업',settings:{privateBrowser:false,computerUse:true},execute:async()=>assert.fail(),chatMessage:async({tools})=>{
    assert.ok(names(tools).includes('browser_open'));assert.ok(names(tools).includes('browser_type'));return {content:'확인했습니다.'};
  }});
});
test('a discovered service alias cannot bypass a discovery-only profile',async()=>{
  const actions=[];let step=0;
  const result=await runSimpleLoop({input:'서비스 확인',settings:{toolAllow:['plugin_search']},maxSteps:3,chatMessage:async({tools})=>{
    if(!step++)return call('service_search',{query:'calendar'});
    assert.ok(!names(tools).some(n=>n.startsWith('connected_service_')));
    return call('connected_service_1',{});
  },execute:async a=>{actions.push(a.tool);return [{name:'calendar.search',inputSchema:{type:'object',properties:{}}}];}});
  assert.deepEqual(actions,['plugin_search']);assert.equal(result.complete,false);
});
test('automatic post-action observations also honor the profile',async()=>{
  assert.deepEqual(await attempt({toolAllow:['open_app']},call('open_app',{name:'fixture'})),['open_app']);
});
test('double-click only profiles advertise the constrained native click variant',async()=>{
  await runSimpleLoop({input:'허용 기능 확인',settings:{toolAllow:['double_click']},execute:async()=>assert.fail(),chatMessage:async({tools})=>{
    const click=tools.find(t=>t.function.name==='click');assert.ok(click);
    assert.deepEqual(click.function.parameters.properties.double.enum,[true]);
    assert.ok(click.function.parameters.required.includes('double'));return {content:'확인했습니다.'};
  }});
});

test('implicit HTML visual review cannot bypass disabled browser capabilities',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'native-policy-'));
  try{
    for(const settings of [{toolAllow:['write']},{computerUse:false},{webMode:'off'},{webEnabled:false}]){
      await fs.writeFile(path.join(root,'index.html'),'<title>before</title>');
      let step=0,captures=0,writes=0,external=0;
      const result=await runSimpleLoop({input:'기존 index.html의 제목을 변경하세요.',settings,maxSteps:4,
        context:{root,requestExternalAssistance:async()=>{external++;return true;}},
        chatMessage:async()=>step++?{content:'변경했습니다.'}:call('write',{path:'index.html',content:'<title>after</title>'}),
        visualCapture:async()=>{captures++;throw Error('forbidden browser started');},
        execute:async a=>{assert.equal(a.tool,'write');writes++;await fs.writeFile(path.join(root,a.path),a.text);return 'saved';}});
      assert.equal(captures,0,JSON.stringify(settings));assert.equal(writes,1);
      assert.equal(result.complete,false);assert.equal(external,0);
      assert.equal(await fs.readFile(path.join(root,'index.html'),'utf8'),'<title>after</title>');
    }
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
