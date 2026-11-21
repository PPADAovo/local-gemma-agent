import test from 'node:test';
import assert from 'node:assert/strict';
import {TaskApproval} from '../task-approval.mjs';

test('one approved task covers its preparation, execution and verification',async()=>{
 const ledger=new TaskApproval();let cards=0;
 const ask=async()=>{cards++;return true;};
 const request='회의 자료를 정리해서 저장해줘';
 await ledger.authorize({request,description:'회의 자료를 정리하고 결과 파일을 저장합니다.'},ask,async()=>false);
 for(const description of ['회의 자료를 읽습니다.','정리한 결과를 저장합니다.','저장된 결과를 확인합니다.'])
  await ledger.authorize({request,description},ask,async()=>true);
 assert.equal(cards,1);
});
test('changed recipients and contents require new approval even if a model claims coverage',async()=>{
 const ledger=new TaskApproval();let cards=0;const ask=async()=>{cards++;return true;};
 const base={request:'메일 보내줘',description:'메일을 보냅니다.',action:{tool:'plugin_call',path:'gmail.send_email',args:{to:'one@example.com',subject:'자료',body:'내용'}}};
 await ledger.authorize(base,ask,async()=>true);
 await ledger.authorize(base,ask,async()=>true);
 await ledger.authorize({...base,action:{...base.action,args:{...base.action.args,to:'two@example.com'}}},ask,async()=>true);
 assert.equal(cards,2);
});
test('denial is not asked again and a new request has no previous authorization',async()=>{
 const ledger=new TaskApproval();let cards=0;const ask=async()=>{cards++;return false;};
 const pending={request:'파일 정리',description:'대상 파일을 삭제합니다.'};
 await assert.rejects(()=>ledger.authorize(pending,ask,async()=>true),/승인하지/);
 await assert.rejects(()=>ledger.authorize(pending,ask,async()=>true),/승인하지/);
 assert.equal(cards,1);
 await ledger.authorize({...pending,request:'다른 파일 정리'},async()=>{cards++;return true;},async()=>true);
 assert.equal(cards,2);
});
