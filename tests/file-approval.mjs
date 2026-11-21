import test from 'node:test';
import assert from 'node:assert/strict';
import {mustAskFileChange,describeFileChange,isDeleteCommand,describeDeleteCommand} from '../file-approval.mjs';
import {TaskApproval} from '../task-approval.mjs';

test('deleting asks in confirm and auto modes; full access deletes (backed up) without asking',()=>{
  for(const createdThisTask of [true,false]){
    assert.equal(mustAskFileChange({kind:'delete',permission:'confirm',existed:true,createdThisTask}),true);
    assert.equal(mustAskFileChange({kind:'delete',permission:'auto',existed:true,createdThisTask}),true);
    assert.equal(mustAskFileChange({kind:'delete',permission:'full',existed:true,createdThisTask}),false);
  }
});

test('the permission table: recording asks only in confirm mode; irreversible command deletion always asks',async()=>{
  const {needsApproval}=await import('../permission-policy.mjs');
  assert.deepEqual(['confirm','auto','full'].map(m=>needsApproval('screen-record',m)),[true,false,false]);
  assert.deepEqual(['confirm','auto','full'].map(m=>needsApproval('command-delete',m)),[true,true,true]);
  assert.deepEqual(['confirm','auto','full'].map(m=>needsApproval('publish',m)),[true,true,false]);
  assert.equal(needsApproval('unknown-kind','full'),true);
});

test('changing a file that already existed asks unless full permission; new results do not',()=>{
  assert.equal(mustAskFileChange({kind:'edit',permission:'auto',existed:true,createdThisTask:false}),true);
  assert.equal(mustAskFileChange({kind:'write',permission:'auto',existed:true,createdThisTask:false}),true);
  assert.equal(mustAskFileChange({kind:'rename',permission:'auto',existed:true,createdThisTask:false}),true);
  assert.equal(mustAskFileChange({kind:'edit',permission:'full',existed:true,createdThisTask:false}),false);
  assert.equal(mustAskFileChange({kind:'edit',permission:'auto',existed:true,createdThisTask:true}),false);
  assert.equal(mustAskFileChange({kind:'write',permission:'auto',existed:false,createdThisTask:false}),false);
  assert.equal(mustAskFileChange({kind:'write',permission:'confirm',existed:false,createdThisTask:false}),true);
});

test('the card names the exact file, its size, and what changes',()=>{
  const stat={size:2048,mtime:new Date('2026-11-11T09:08:53Z')};
  const del=describeFileChange({kind:'delete',full:'C:\\w\\작업공간\\치이카와달력.html',stat});
  assert.match(del,/삭제할 파일: 치이카와달력\.html/);
  assert.match(del,/위치: C:\\w\\작업공간/);
  assert.match(del,/2\.0KB/);
  assert.match(del,/원래 있던 파일/);
  assert.match(del,/이 파일 하나만/);
  const edit=describeFileChange({kind:'edit',full:'C:\\w\\a.js',stat,action:{old:'let x=1;',new:'let x=2;'}});
  assert.match(edit,/- let x=1;/);
  assert.match(edit,/\+ let x=2;/);
  const over=describeFileChange({kind:'write',full:'C:\\w\\a.txt',stat,action:{text:'새 내용'}});
  assert.match(over,/덮어쓸 파일/);
});

test('delete commands are recognized and explained as not undoable',()=>{
  assert.ok(isDeleteCommand("Remove-Item 'C:\\w\\*' -Recurse"));
  assert.ok(isDeleteCommand('del a.txt'));
  assert.ok(!isDeleteCommand('Get-ChildItem C:\\w'));
  const text=describeDeleteCommand("Remove-Item 'C:\\w\\*' -Recurse");
  assert.match(text,/되돌릴 수 없/);
  assert.match(text,/한꺼번에/);
});

test('a strict (delete) approval never rides on an earlier similar approval',async()=>{
  const ledger=new TaskApproval();let asked=0;
  const ask=async()=>{asked++;return true;};
  await ledger.authorize({request:'r',description:'삭제: a.txt',action:{tool:'delete',path:'a.txt'},strict:true},ask,async()=>true);
  await ledger.authorize({request:'r',description:'삭제: b.txt',action:{tool:'delete',path:'b.txt'},strict:true},ask,async()=>true);
  assert.equal(asked,2);
});
