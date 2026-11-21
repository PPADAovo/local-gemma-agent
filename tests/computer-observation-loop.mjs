import test from 'node:test';
import assert from 'node:assert/strict';
import {runSimpleLoop} from '../simple-loop.mjs';

const frame={image:'aW1hZ2U=',imageWidth:100,imageHeight:100,left:1000,top:500,width:200,height:200,elements:[{id:7,name:'확인',x:1150,y:650,type:'Button'}],texts:['선택 전'],window:{title:'편집 앱',handle:12,pid:34,rect:[1000,500,1200,700]}};
const call=(name,args={})=>({function:{name,arguments:args}});
const message=(name,args)=>({tool_calls:[call(name,args)]});
async function scenario(script,execute,options={}){let step=0;return runSimpleLoop({input:'편집 앱에서 작업하고 확인해줘',maxSteps:8,chatMessage:async request=>typeof script==='function'?script(request,step++):script[step++]||{content:'확인했습니다.'},execute,...options});}

test('native pointer dispatch carries the observed window and bounds',async()=>{
  const actions=[];
  await scenario([message('look'),message('click',{target:'E7'})],async a=>{actions.push(a);return a.tool==='look'?frame:{ok:true};});
  const click=actions.find(a=>a.tool==='click');
  assert.equal(click.observedHandle,12);assert.deepEqual(click.observedRect,[1000,500,1200,700]);
});

test('each UI mutation returns a fresh frame to the model before the next decision',async()=>{
  const actions=[];let looks=0;
  await scenario((request,step)=>{
    if(!step)return message('look');if(step===1)return message('click',{target:'E7'});
    assert.ok(request.messages.some(m=>/조작 후 결과/.test(m.content)&&/선택 완료/.test(m.content)));
    return {content:'선택 완료를 확인했습니다.'};
  },async a=>{actions.push(a.tool);return a.tool==='look'?{...frame,texts:[++looks>1?'선택 완료':'선택 전']}:{ok:true};});
  assert.deepEqual(actions,['look','click','look']);
});

test('second UI input in a batch cannot use a frame the model has not seen',async()=>{
  const actions=[];
  await scenario([message('look'),{tool_calls:[call('click',{target:'E7'}),call('click',{target:'20,20'})]}],async a=>{actions.push(a.tool);return a.tool==='look'?frame:{ok:true};});
  assert.equal(actions.filter(a=>a==='click').length,1);
});

test('out of frame accessibility coordinates never reach pointer execution',async()=>{
  const actions=[];
  await scenario([message('look'),message('click',{target:'E7'})],async a=>{actions.push(a.tool);return a.tool==='look'?{...frame,elements:[{...frame.elements[0],x:99999}]}:{ok:true};});
  assert.equal(actions.includes('click'),false);
});

test('failed post-action observation prevents a success claim',async()=>{
  let looks=0;
  const result=await scenario([message('look'),message('click',{target:'E7'})],async a=>{
    if(a.tool==='look'){if(++looks>1)throw Error('capture failed');return frame;}return {ok:true};
  });
  assert.equal(result.complete,false);assert.match(result.answer,/확인|검증/);
});

test('drag and right click use current frame and discovery reaches existing executor',async()=>{
  const actions=[];
  await scenario([message('discover_tools',{query:'premiere'}),message('look'),message('drag',{points:[{x:10,y:20},{x:50,y:80}]}),message('right_click',{target:'E7'})],async a=>{actions.push(a);return a.tool==='look'?frame:{ok:true};});
  assert.equal(actions[0].tool,'discover_tools');assert.equal(actions[0].text,'premiere');
  const drag=actions.find(a=>a.tool==='drag');assert.ok(drag);assert.deepEqual(drag.points,[{x:1020,y:540},{x:1100,y:660}]);assert.equal(drag.frameWindow.handle,12);
  assert.ok(actions.find(a=>a.tool==='right_click'));
});

test('drag resolves both endpoints from the current element list without guessing image coordinates',async()=>{
  const actions=[],dragFrame={...frame,elements:[...frame.elements,{id:8,name:'빈 타임라인',x:1020,y:540,type:'Pane'}]};
  await scenario([message('look'),message('drag',{from:'E7',to:'E8'})],async a=>{actions.push(a);return a.tool==='look'?dragFrame:'ok';});
  const drag=actions.find(a=>a.tool==='drag');assert.ok(drag);
  assert.deepEqual(drag.points,[{x:1150,y:650},{x:1020,y:540}]);
  assert.equal(drag.observedHandle,12);assert.deepEqual(drag.observedRect,[1000,500,1200,700]);assert.equal(drag.frameWindow.handle,12);
  assert.deepEqual(actions.map(a=>a.tool),['look','drag','look']);
});

test('drag supports a current element endpoint paired with a scaled image point',async()=>{
  const actions=[];
  await scenario([message('look'),message('drag',{from:'E7',to:'10,20'})],async a=>{actions.push(a);return a.tool==='look'?frame:'ok';});
  assert.deepEqual(actions.find(a=>a.tool==='drag')?.points,[{x:1150,y:650},{x:1020,y:540}]);
});

test('drag rejects mixed formats, missing or ambiguous endpoints and out-of-frame targets',async()=>{
  const invalid=[{}, {from:'E7'}, {to:'E7'}, {from:'',to:'E7'}, {from:'  ',to:'E7'}, {points:[{x:1,y:1},{x:2,y:2}],from:'E7'},
    {points:[{x:1,y:1},{x:2,y:2}],from:'E7',to:'E7'}, {from:'E404',to:'E7'},
    {from:'E7',to:'100,20'}, {from:'E99',to:'E7'}, {from:'동일 이름',to:'E7'}];
  const badFrame={...frame,elements:[...frame.elements,{id:99,name:'outside',x:99999,y:650},{id:8,name:'동일 이름',x:1100,y:600},{id:9,name:'동일 이름',x:1110,y:610},{id:10,name:'',x:1120,y:620}]};
  for(const args of invalid){
    const actions=[];
    await scenario([message('look'),message('drag',args)],async a=>{actions.push(a.tool);return badFrame;});
    assert.deepEqual(actions,['look'],JSON.stringify(args));
  }
});

test('drag cannot use endpoints from an old window or an unseen batch observation',async()=>{
  const actions=[];let looks=0;
  await scenario([message('look'),message('focus',{window:'other'}),message('drag',{from:'E7',to:'20,20'})],async a=>{
    actions.push(a.tool);if(a.tool==='look')return ++looks===1?frame:{...frame,elements:[],window:{...frame.window,handle:99}};return 'ok';
  });
  assert.deepEqual(actions,['look','focus','look']);
  const batched=[];
  await scenario([{tool_calls:[call('look'),call('drag',{from:'E7',to:'20,20'})]}],async a=>{batched.push(a.tool);return frame;});
  assert.deepEqual(batched,['look']);
});

test('external assistance is requested after two concrete failures and continues same history',async()=>{
  let assists=0;
  await scenario([message('read',{path:'a'}),message('read',{path:'b'}),message('list',{path:''})],async a=>{if(a.tool==='read')throw Error('local reader failure');return 'files';},{context:{requestExternalAssistance:async reason=>{assert.match(reason.message,/local reader failure/);assists++;return true;}}});
  assert.equal(assists,1);
});

test('permission denial is never escalated to another AI',async()=>{
  let assists=0;
  await scenario([message('read',{path:'a'}),message('read',{path:'b'})],async()=>{throw Error('권한이 거부되었습니다');},{context:{requestExternalAssistance:async()=>{assists++;return true;}}});
  assert.equal(assists,0);
});

test('all batched tool responses precede automatic screenshot messages',async()=>{
  await scenario((request,step)=>{
    if(!step)return message('look');
    if(step===1)return {tool_calls:[call('click',{target:'E7'}),call('list',{path:''})]};
    const index=request.messages.findLastIndex(m=>m.role==='assistant'&&m.tool_calls?.length===2);
    assert.deepEqual(request.messages.slice(index+1,index+3).map(m=>m.role),['tool','tool']);
    assert.equal(request.messages[index+3].role,'user');return {content:'확인했습니다.'};
  },async a=>a.tool==='look'?frame:'ok');
});

test('an unrelated successful read cannot erase a failed delivery',async()=>{
  const result=await scenario([message('service_call',{name:'mail.send',args:{to:'fixture'}}),message('list',{path:''}),{content:'메일을 보냈습니다.'}],async a=>{if(a.tool==='plugin_call')throw Error('delivery failed');return 'files';});
  assert.equal(result.complete,false);assert.match(result.answer,/delivery failed|실패|완료/);
});

test('successful retry of the failed operation permits completion',async()=>{
  let reads=0;
  const result=await scenario([message('read',{path:'a'}),message('read',{path:'a'}),{content:'자료 내용을 확인했습니다.'}],async()=>{if(++reads===1)throw Error('temporary failure');return 'actual content';});
  assert.equal(result.complete,true);
});

test('an unexecuted action claim is given one repair opportunity then stays incomplete',async()=>{
  const result=await scenario([{content:'저장했습니다.'},{content:'저장했습니다.'}],async()=>assert.fail('no operation requested'));
  assert.equal(result.complete,false);
});

test('browser tasks use the existing DOM tools instead of desktop coordinate input',async()=>{
  const actions=[];
  await scenario([message('browser_open',{url:'https://example.invalid/'}),message('browser_click',{target:'B3'}),message('browser_type',{target:'B5',text:'검색'}),message('browser_key',{keys:'enter'}),message('browser_read')],async a=>{actions.push(a);return 'URL: https://example.invalid/\n검색 결과';});
  assert.deepEqual(actions.map(a=>a.tool),['browser_open','browser_click','browser_type','browser_key','browser_read']);
  assert.equal(actions[2].target,'B5');assert.equal(actions[2].text,'검색');
});

test('a repeated no-progress loop can escalate once while retaining observations',async()=>{
  let assists=0,reads=0;
  const result=await scenario((request)=>{
    if(assists){assert.ok(request.messages.some(m=>m.role==='tool'));return {content:'화면을 확인했습니다.'};}
    return message('look');
  },async()=>{reads++;return frame;},{context:{requestExternalAssistance:async()=>{assists++;return true;}},maxSteps:10});
  assert.equal(assists,1);assert.equal(reads,2);assert.equal(result.complete,true);
});

test('successful external activation permits one fresh observation after a repeated look loop',async()=>{
  let assists=0,reads=0,externalTurns=0;
  const result=await scenario(()=>{
    if(!assists||externalTurns++===0)return message('look');
    return {content:'새 화면을 확인했습니다.'};
  },async()=>{reads++;return frame;},{context:{requestExternalAssistance:async()=>{assists++;return true;}},maxSteps:10});
  assert.equal(assists,1);assert.equal(reads,3);assert.equal(result.complete,true);
});

test('external observation recovery preserves completed mutations and unresolved mutation failures',async()=>{
  let assists=0,turn=0,externalTurns=0,reads=0,writes=0;
  const result=await scenario(()=>{
    if(assists)return [message('write',{path:'a.txt',content:'saved'}),message('look'),{content:'작업을 완료했습니다.'}][externalTurns++];
    if(turn++===0)return message('write',{path:'a.txt',content:'saved'});
    if(turn===2)return message('service_call',{name:'mail.send',args:{}});
    return message('look');
  },async a=>{if(a.tool==='write'){writes++;return 'saved';}if(a.tool==='plugin_call')throw Error('delivery failed');reads++;return frame;},
  {context:{requestExternalAssistance:async()=>{assists++;return true;}},maxSteps:12});
  assert.equal(assists,1);assert.equal(reads,3);assert.equal(writes,1);
  assert.equal(result.complete,false);assert.match(result.answer,/delivery failed/);
});

test('coded permission refusal and cancelled observation never request external assistance',async()=>{
  for(const error of [Object.assign(Error('blocked'),{code:'PERMISSION_DENIED'}),Object.assign(Error('stopped'),{name:'AbortError'})]){
    let assists=0;
    const result=await scenario([message('look'),message('click',{target:'E7'}),message('look')],async a=>{if(a.tool==='look')throw error;return 'ok';},{context:{requestExternalAssistance:async()=>{assists++;return true;}}});
    assert.equal(assists,0);assert.equal(result.complete,false);
  }
});

test('failed read can recover through a corrected path only with source-backed final assessment',async()=>{
  let step=0;
  const result=await scenario(request=>{
    if(request.format?.properties?.recovered)return {content:JSON.stringify({recovered:true,event:2,quote:'requested document contents'})};
    return [message('read',{path:'typo'}),message('read',{path:'correct'}),{content:'문서 내용을 확인했습니다.'}][step++];
  },async a=>{if(a.path==='typo')throw Error('file missing');return 'requested document contents';});
  assert.equal(result.complete,true);
});

test('look and click in one model batch do not act on an unseen screenshot',async()=>{
  const actions=[];
  await scenario([{tool_calls:[call('look'),call('click',{target:'E7'})]}],async a=>{actions.push(a.tool);return frame;});
  assert.deepEqual(actions,['look']);
});

test('batched browser mutations cannot use stale element references',async()=>{
  const actions=[];
  await scenario([message('browser_open',{url:'https://example.invalid'}),{tool_calls:[call('browser_click',{target:'B3'}),call('browser_type',{target:'B5',text:'old ref'})]}],async a=>{actions.push(a.tool);return 'new snapshot';});
  assert.deepEqual(actions,['browser_open','browser_click']);
});

test('native edit passes exact before and after text to deterministic executor',async()=>{
  const actions=[];
  await scenario([message('edit',{path:'example.txt',before:'old\r\n',after:'new\r\n'}),message('edit',{path:'example.txt',before:'remove me',after:''})],async a=>{actions.push(a);return 'edited and verified';});
  assert.equal(actions.length,2);
  assert.equal(actions[0].tool,'edit');assert.equal(actions[0].old,'old\r\n');assert.equal(actions[0].new,'new\r\n');
  assert.equal(actions[1].new,'');
});
