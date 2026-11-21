import test from 'node:test';
import assert from 'node:assert/strict';
import {runAgentLoop} from '../agent-loop.mjs';
for(const met of [true,false])test(`service receipt receives one final audit without checklist loops (met=${met})`,async()=>{
 let decisions=0,audits=0,sends=0;
 const result=await runAgentLoop({input:'서비스로 보고서를 전송해 줘',maxSteps:5,settings:{toolAllow:['plugin_call','reply']},context:{},
 chat:async(messages,schema)=>{
  if(schema.properties.kind)return JSON.stringify({kind:'action',access:'operate',surface:'other',goal:'보고서 전송',steps:['보고서 전송','전송 결과 확인'],tools:['plugin_call'],criteria:['보고서 전송 성공'],missing:''});
  if(schema.properties.checks){audits++;const d=JSON.parse(messages.at(-1).content),e=d.evidence.find(e=>e.tool==='plugin_call');return JSON.stringify({checks:[{number:1,met,proof:[{id:e.id,line:1}],gap:met?'':'수신 대상 미확인'}],missing:met?'':'수신 대상 미확인',stages:[]});}
  decisions++;return JSON.stringify(decisions===1?{tool:'plugin_call',path:'service.send_report',text:'{}'}:{tool:'reply',text:'보고서를 전송했습니다. 영수증 receipt-1'});
 },execute:async()=>{sends++;return '보고서 전송 성공, 영수증 receipt-1';}});
 assert.equal(result.complete,met,result.answer);
 assert.equal(sends,1);
 assert.equal(audits,1,'unchanged evidence must not be audited repeatedly');
 assert.equal(decisions,met?2:3,'completed action must not loop over checklist bookkeeping');
});
