import test from 'node:test';
import assert from 'node:assert/strict';
import {runSimpleLoop,toAction} from '../simple-loop.mjs';
import {createServiceRuntime,validateArguments} from '../service-agent-runtime.mjs';
import * as plugins from '../gemma-plugins.mjs';
test('native file read can follow executor pagination offsets',()=>{
  assert.equal(toAction('read',{path:'large.txt',offset:6000}).text,'6000');
});

test('a full discovered registry still refreshes an existing service schema',()=>{
  const runtime=createServiceRuntime();
  runtime.register(Array.from({length:32},(_,i)=>({name:'service.'+i,inputSchema:{type:'object',properties:{}}})));
  runtime.register([{name:'service.0',inputSchema:{type:'object',properties:{query:{type:'string'}},required:['query']}}]);
  assert.deepEqual(runtime.tools()[0].function.parameters.required,['query']);
});

const spec={name:'calendar.search',description:'Find events',inputSchema:{type:'object',properties:{limit:{type:'integer',minimum:1},query:{type:'string'}},required:['limit'],additionalProperties:false}};
const call=(name,args)=>({tool_calls:[{id:'call-1',function:{name,arguments:args}}]});

test('plugin bridge preserves structured pagination beyond the old truncation boundary',()=>{
  const output=plugins.serializeToolResult({structuredContent:{events:['x'.repeat(20000)],next_page_token:'next-page'}});
  assert.equal(JSON.parse(output).next_page_token,'next-page');
  assert.equal(JSON.parse(output).events[0].length,20000);
  assert.throws(()=>plugins.serializeToolResult({isError:true,content:[{type:'text',text:'denied'}]}),/denied/);
});

test('registry and observations are isolated between runs and reject unknown result IDs',()=>{
  const first=createServiceRuntime(),second=createServiceRuntime();first.register([spec]);
  const saved=JSON.parse(first.describe('x'.repeat(7000)));
  assert.equal(second.tools().length,0);
  assert.equal(second.resolve(first.tools()[0].function.name),undefined);
  assert.throws(()=>second.read({result_id:saved.result_id}),/없는/);
  assert.throws(()=>first.read({result_id:saved.result_id,offset:-1}),/offset/);
  assert.equal(JSON.parse(first.read({result_id:saved.result_id,offset:7000})).next_offset,null);
});

test('basic schema validation catches missing, extra, numeric and nested invalid values',()=>{
  for(const args of [{},{limit:0},{limit:1.5},{limit:1,extra:true}])assert.ok(validateArguments(args,spec.inputSchema).length);
  assert.ok(validateArguments({rows:['bad']},{type:'object',properties:{rows:{type:'array',items:{type:'integer'}}}}).length);
  assert.equal(validateArguments({limit:2,query:'헌혈'},spec.inputSchema).length,0);
});

test('discovered service schema becomes callable and uses the existing executor',async()=>{
  const actions=[];let step=0;
  const result=await runSimpleLoop({input:'일정 검색 후 파일 저장',chatMessage:async({tools,messages})=>{
    if(step++===0)return call('service_search',{query:'calendar'});
    if(step===2){const tool=tools.find(t=>t.function.description.includes('Find events'));assert.ok(tool,'discovered native tool');return call(tool.function.name,{limit:5});}
    if(step===3){assert.match(messages.at(-1).content,/헌혈/);return call('write',{path:'events.txt',content:'헌혈'});}
    return {content:'결과를 저장했습니다.'};
  },execute:async a=>{actions.push(a);return a.tool==='plugin_search'?[spec]:a.tool==='plugin_call'?{events:['헌혈']}:'saved';}});
  assert.equal(result.complete,true);
  assert.deepEqual(actions.map(a=>a.tool),['plugin_search','plugin_call','write']);
  assert.equal(actions[1].path,'calendar.search');
  assert.deepEqual(JSON.parse(actions[1].text),{limit:5});
});

test('invalid discovered arguments are rejected before executor and can be corrected',async()=>{
  let step=0,alias;const actions=[];
  await runSimpleLoop({input:'일정 조회',chatMessage:async({tools,messages})=>{
    step++;
    if(step===1)return call('service_search',{query:'calendar'});
    if(step===2){alias=tools.find(t=>t.function.description.includes('Find events'))?.function.name;assert.ok(alias);return call(alias,{limit:'five'});}
    if(step===3){assert.match(messages.at(-1).content,/입력/);return call(alias,{limit:2});}
    return {content:'조회했습니다.'};
  },execute:async a=>{actions.push(a);return a.tool==='plugin_search'?[spec]:'events';}});
  assert.equal(actions.filter(a=>a.tool==='plugin_call').length,1);
  assert.equal(JSON.parse(actions.at(-1).text).limit,2);
});

test('long tool result can be read without executing the external operation again',async()=>{
  let step=0,executions=0;
  await runSimpleLoop({input:'긴 결과 확인',chatMessage:async({messages})=>{
    step++;
    if(step===1)return call('service_call',{name:'calendar.search',args:{}});
    if(step===2){const envelope=JSON.parse(messages.at(-1).content);assert.equal(envelope.truncated,true);assert.ok(envelope.result_id);return call('read_tool_result',{result_id:envelope.result_id,offset:9000});}
    assert.match(messages.at(-1).content,/LAST_EVENT/);return {content:'끝까지 확인했습니다.'};
  },execute:async()=>{executions++;return 'x'.repeat(9000)+'LAST_EVENT';}});
  assert.equal(executions,1);
});

test('escaped result pages remain readable and are not wrapped in another result',async()=>{
  let step=0,id;
  await runSimpleLoop({input:'결과 확인',chatMessage:async({messages})=>{
    if(step++===0)return call('service_call',{name:'sample.read',args:{}});
    if(step===2){id=JSON.parse(messages.at(-1).content).result_id;return call('read_tool_result',{result_id:id,offset:4000});}
    const page=JSON.parse(messages.at(-1).content);assert.equal(page.result_id,id);assert.equal(page.offset,4000);assert.equal(page.content,'"'.repeat(4000));
    return {content:'확인했습니다.'};
  },execute:async()=>'"'.repeat(9000)});
});
