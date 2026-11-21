import assert from 'node:assert/strict';
import test from 'node:test';
import {searchTools,unknownToolMessage,argumentProblem} from '../gemma-plugins.mjs';
import {upcomingEvents} from '../service-workflows.mjs';

const tools={
  'google_calendar.search_events':{description:'Search events',inputSchema:{additionalProperties:false,properties:{time_min:{},time_max:{},timezone_str:{},max_results:{},calendar_id:{},query:{}}}},
  'google_calendar.list_calendars':{description:'List calendars',inputSchema:{properties:{max_results:{}}}},
  'google_calendar.create_event':{description:'Create event'},
  'gmail.send_email':{description:'Send mail'}
};

test('a service-name or Korean intent search returns every tool of that service',()=>{
  for(const query of ['google_calendar','일정','캘린더 일정 조회'])
    assert.deepEqual(searchTools(tools,query).map(t=>t.name).sort(),['google_calendar.create_event','google_calendar.list_calendars','google_calendar.search_events'],query);
});

test('an invented tool name gets the real names and the closest match',()=>{
  const message=unknownToolMessage(tools,'google_calendar.list_events');
  assert.match(message,/google_calendar\.search_events/);
  assert.match(message,/가장 비슷한 도구는 google_calendar\.search_events/);
});

test('wrong argument names are caught before the call with the right names',()=>{
  const message=argumentProblem('google_calendar.search_events',tools['google_calendar.search_events'].inputSchema,{calendar_ids:['primary'],response_timezone_str:'Asia/Seoul'});
  assert.match(message,/calendar_ids\(→ calendar_id\)/);
  assert.match(message,/response_timezone_str\(→ timezone_str\)/);
  assert.equal(argumentProblem('x',tools['google_calendar.search_events'].inputSchema,{time_min:'now'}),'');
});
test('service validation accepts nullable/empty required values and open properties when schema permits them',()=>{
  const schema={type:'object',properties:{query:{type:['string','null']}},required:['query'],additionalProperties:true};
  assert.equal(argumentProblem('service',schema,{query:null,custom:1}),'');
  assert.equal(argumentProblem('service',schema,{query:''}),'');
  assert.match(argumentProblem('service',schema,{query:42}),/입력/);
  assert.match(argumentProblem('service',schema,[]),/입력/);
});
test('service argument validation enforces composed schemas without top-level properties',()=>{
  const allOf={type:'object',allOf:[{properties:{count:{type:'integer',minimum:1}},required:['count']}]};
  assert.match(argumentProblem('composed',allOf,{}),/count/);
  assert.match(argumentProblem('composed',allOf,{count:0}),/최소값/);
  assert.equal(argumentProblem('composed',allOf,{count:2,optional:'allowed'}),'');
  const anyOf={anyOf:[{properties:{query:{type:'string'}},required:['query']},{properties:{id:{type:'integer'}},required:['id']}]};
  assert.match(argumentProblem('composed',anyOf,{query:42}),/조건/);
  assert.equal(argumentProblem('composed',anyOf,{id:2}),'');
  assert.match(argumentProblem('forbidden',false,{}),/허용/);
  assert.equal(argumentProblem('unknown',undefined,{custom:1}),'');
  assert.equal(argumentProblem('open',{type:'object'},{custom:1}),'');
});

test('upcoming events merges calendars, skips holidays and sorts by start',async()=>{
  const calls=[];
  const call=async(_q,{name,args})=>{
    calls.push([name,args.calendar_id]);
    if(name==='google_calendar.list_calendars')return JSON.stringify({calendars:[
      {id:'primary',summary:'내 캘린더'},{id:'family@group.calendar.google.com',summary:'가족'},{id:'ko.south_korea#holiday@group.v.calendar.google.com',summary:'휴일'}]});
    const byCalendar={primary:[{summary:'B',start:'2026-11-22T09:00:00',status:'confirmed'}],
      'family@group.calendar.google.com':[{summary:'A',start:'2026-11-20T09:00:00',status:'confirmed'},{summary:'X',start:'2026-11-19T12:00:00',status:'cancelled'}]};
    return JSON.stringify({events:byCalendar[args.calendar_id]||[]});
  };
  const result=JSON.parse(await upcomingEvents({count:5},call,new Date('2026-11-19T02:00:00Z')));
  assert.deepEqual(result.events.map(e=>e.title),['A','B']);
  assert.equal(result.events[0].calendar,'가족');
  assert.ok(!calls.some(([,id])=>String(id).includes('holiday')));
});

test('read-only markers survive even when a service has many tools',()=>{
  const many=Object.fromEntries(Array.from({length:15},(_,i)=>['gmail.tool_'+String(i).padStart(2,'0'),{description:'t',annotations:{readOnlyHint:true}}]));
  const listed=searchTools(many,'gmail');
  assert.equal(listed.length,15);
  assert.ok(listed.every(t=>t.annotations?.readOnlyHint===true));
});

import {runAgentLoop} from '../agent-loop.mjs';
test('a failed read-only service call (made-up IDs) is retried after a search instead of ending the task',async()=>{
  const calls=[];let turn=0;
  await runAgentLoop({input:'메일 정리해줘',maxSteps:8,settings:{noSpec:true,toolAllow:['plugin_search','plugin_call']},context:{},
    chat:async(messages,schema)=>{
      if(schema?.properties?.verified)return JSON.stringify({verified:true,quote:'',gap:''});
      if(schema?.properties?.checks)return JSON.stringify({checks:[],missing:'',stages:[]});
      const steps=[{tool:'plugin_search',text:'gmail',path:''},
        {tool:'plugin_call',path:'gmail.batch_read_email',text:'{"message_ids":["made-up"]}'},
        {tool:'plugin_call',path:'gmail.search_email_ids',text:'{"query":"in:inbox"}'},
        {tool:'reply',text:'메일 목록을 확인했습니다.'}];
      return JSON.stringify({thought:'',...steps[Math.min(turn++,steps.length-1)]});
    },
    execute:async a=>{calls.push(a.path||a.tool);
      if(a.tool==='plugin_search')return JSON.stringify([{name:'gmail.batch_read_email',description:'read',annotations:{readOnlyHint:true}},{name:'gmail.search_email_ids',description:'search',annotations:{readOnlyHint:true}}]);
      if(a.path==='gmail.batch_read_email')throw Error('ActionError: Gmail `get_message` failed: Gmail API request failed. HTTP status: 404. Retryable: no.');
      return '{"message_ids":["real1"]}';}});
  assert.ok(calls.includes('gmail.search_email_ids'),calls.join(' | '));
});
