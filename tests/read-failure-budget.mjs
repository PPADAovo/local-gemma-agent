import test from 'node:test';
import assert from 'node:assert/strict';
import {runAgentLoop} from '../agent-loop.mjs';

// 2026-11-20 Gmail summary: three argument-format mistakes on search_email_ids used up the whole read-failure
// allowance, so a later 404 from batch_read_email (a miscopied ID) stopped the task as "재시도 불가".
// The allowance counts consecutive failures; a successful service call resets it.
test('earlier read mistakes do not make a later read 404 fatal after a success',async()=>{
 const plan=[
  {path:'gmail.search_email_ids',fail:'입력 오류: args.query 필요'},
  {path:'gmail.search_email_ids',fail:'입력 오류: args.query 필요'},
  {path:'gmail.search_email_ids',fail:'입력 오류: args.query 필요'},
  {path:'gmail.search_email_ids',ok:'{"message_ids":["1a1f36ce58ae4086"]}'},
  {path:'gmail.batch_read_email',fail:'ActionError: Gmail `get_message` failed: Gmail API request failed. HTTP status: 404. Retryable: no.'},
  {path:'gmail.batch_read_email',ok:'{"emails":[{"id":"1a1f36ce58ae4086","subject":"약관 안내"}]}'}
 ];
 let turn=0;const executed=[];
 const result=await runAgentLoop({input:'받은편지함 메일 요약해줘',settings:{noSpec:true,toolAllow:['plugin_call','reply']},maxSteps:12,
  chat:async(messages,schema)=>{
   if(schema?.properties?.verified)return JSON.stringify({verified:true,quote:'약관 안내',gap:''});
   const step=plan[turn++];
   // Distinct arguments per call: identical repeats are (correctly) blocked by the loop's repeat guard.
   return JSON.stringify(step?{tool:'plugin_call',path:step.path,text:JSON.stringify({attempt:turn}),thought:'메일 확인'}:{tool:'reply',text:'요약: 약관 안내 메일 1통',path:'',thought:'보고'});
  },
  execute:async a=>{const step=plan[executed.length];executed.push(a.path);if(step?.fail)throw Error(step.fail);return step?.ok??'ok';}});
 assert.doesNotMatch(result.answer,/재시도 불가/);
 assert.equal(executed.length,6,executed.join(','));
 assert.match(result.answer,/약관 안내/);
});

import {parseArgsObject} from '../agent-loop.mjs';
// 2026-11-20: the model dropped the final '}' after a 50-ID list, and both attempts were rejected as invalid JSON.
test('service arguments with missing closing brackets are repaired, real errors are not',()=>{
 assert.deepEqual(parseArgsObject('{"message_ids":["1a1f608adc8a9a5c","1a1f3dbfa84c50e4"]'),{message_ids:['1a1f608adc8a9a5c','1a1f3dbfa84c50e4']});
 assert.deepEqual(parseArgsObject('{"a":{"b":[1,2]'),{a:{b:[1,2]}});
 assert.equal(parseArgsObject('{"query":"unterminated'),null);
 assert.equal(parseArgsObject('{"a":1]}'),null);
});
