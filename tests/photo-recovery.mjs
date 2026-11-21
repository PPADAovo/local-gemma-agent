import test from 'node:test';
import assert from 'node:assert/strict';
import {runAgentLoop} from '../agent-loop.mjs';

test('photo-background recovers from empty search and artwork; only the accepted photo reaches cutout',async()=>{
 const actions=[],usedQueries=[],decisions=[];
 const a=(tool,path='',text='')=>({tool,path,text,thought:'작업'});
 const pending=[a('read','calendar.html'),a('photo_search','','흰토끼')];
 await runAgentLoop({input:'흰토끼 실사진을 찾아 캘린더 배경에 적용',context:{},settings:{toolAllow:['read','photo_search','photo_save','photo_cutout','photo_background']},maxSteps:12,
 chat:async(messages,schema)=>{
  const f=schema.properties;
  if(f.workflow)return JSON.stringify({kind:'action',surface:'other',session:'any',desktop:'none',access:'operate',workflow:'photo-background',goal:'사진 배경 적용',steps:['사진 검색','배경 적용'],criteria:['실사진이 배경으로 쓰임'],done_when:'배경 확인',tools:['read','photo_search','photo_save','photo_cutout','photo_background']});
  if(f.decision?.enum.includes('cut')){
   decisions.push('cut');const facts=JSON.parse(messages.at(-1).content);
   assert.equal(facts.acceptedPhoto.license,'CC0');assert.equal(facts.acceptedPhoto.sourcePath,'assets/photo-22.jpg');
   return JSON.stringify({decision:'cut',engine:'isnet',region:[100,100,900,900],regionPurpose:'subject_hint',reason:'자연사진'});
  }
  if(f.decision?.enum.includes('search_again')){
   const facts=JSON.parse(messages.at(-1).content);
   if(!facts.candidates.length){decisions.push('rephrase');return JSON.stringify({decision:'search_again',id:'',query:'white rabbit photograph'});}
   const id=String(facts.candidates[0].id);decisions.push('select '+id);return JSON.stringify({decision:'select',id,query:''});
  }
  if(f.tool)return JSON.stringify(pending.shift()??a('reply','','중지'));
  throw Error('unexpected schema '+Object.keys(f).join(','));
 },
 execute:async op=>{
  actions.push(op);
  if(op.tool==='read')return '<main class="calendar">calendar</main>';
  if(op.tool==='photo_search'){
   usedQueries.push(op.text);
   return op.text==='흰토끼'?[]:[{id:'11',title:'drawing'},{id:'22',title:'rabbit photo'}];
  }
  if(op.tool==='photo_save'){const good=op.text==='22';
   return {visualObservation:'image',report:good?'accepted':'rejected',photoReview:{id:op.text,match:good,visible:good?'white rabbit':'painting',...(good?{sourcePath:'assets/photo-22.jpg',output:'assets/photo-22-cutout.png',license:'CC0'}:{})}};}
  if(op.tool==='photo_cutout')throw Object.assign(Error('end of controlled workflow'),{code:'USER_HANDOFF_STOP'});
  throw Error('unexpected tool');
 }});
 assert.deepEqual(usedQueries,['흰토끼','white rabbit photograph']);
 assert.deepEqual(actions.filter(v=>v.tool==='photo_save').map(v=>v.text),['11','22']);
 assert(!actions.some(v=>v.tool==='photo_cutout' && v.path==='assets/rabbit.jpg'));
 const cut=actions.find(v=>v.tool==='photo_cutout');assert.equal(cut.path,'assets/photo-22.jpg');assert.equal(cut.text,'assets/photo-22-cutout.png');assert.equal(cut.engine,'isnet');assert.equal(cut.regionPurpose,'subject_hint');assert.deepEqual(cut.region,[100,100,900,900]);
 assert.deepEqual(decisions,['rephrase','select 11','select 22','cut']);
});
