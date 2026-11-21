import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyEmail,inboxCleanup,INBOX_CLEANUP} from '../service-workflows.mjs';
import {coerceArguments,argumentProblem} from '../gemma-plugins.mjs';
import {TaskApproval} from '../task-approval.mjs';
import {announceWork} from '../work-progress.mjs';

const mail=(id,subject,from,labels=['INBOX'],extra={})=>({id,subject,from_:from,labels,snippet:'',...extra});

test('security, billing, starred and self-sent mail is always kept, even in a promotions-like category',()=>{
  assert.equal(classifyEmail(mail('a','[GitHub] Security alert: new sign-in','noreply@github.com',['INBOX','CATEGORY_UPDATES'])).decision,'keep');
  assert.equal(classifyEmail(mail('b','카드 이용대금 명세서','card@examplecard.com',['INBOX','CATEGORY_PROMOTIONS'])).decision,'keep');
  assert.equal(classifyEmail(mail('c','Big sale 50% off','shop@x.com',['INBOX','STARRED','CATEGORY_PROMOTIONS'])).decision,'keep');
  assert.equal(classifyEmail(mail('d','바탕화면 녹화 영상','me@gmail.com',['INBOX','SENT'])).decision,'keep');
  assert.equal(classifyEmail(mail('e','[게임사] 개인정보 이용내역 안내','noreply@game.example.com',['INBOX','CATEGORY_UPDATES'])).decision,'keep');
});

test('promotions and newsletters are deleted, unclear mail is left for the user',()=>{
  assert.equal(classifyEmail(mail('p','Player, save up to 75%','news@store.example.com',['INBOX','CATEGORY_PROMOTIONS'])).decision,'delete');
  assert.equal(classifyEmail(mail('n','[오늘뉴스] 회원님, 오늘의 뉴스레터가 도착했어요.','webmaster@news.example.co.kr',['INBOX','CATEGORY_UPDATES'])).decision,'delete');
  assert.equal(classifyEmail(mail('w','ChartHub weekly overview.','noreply@charts.example.com',['INBOX','CATEGORY_UPDATES'])).decision,'delete');
  assert.equal(classifyEmail(mail('u','Thank you for joining ToolHub','hello@tools.example.com',['INBOX','CATEGORY_UPDATES'])).decision,'unsure');
  // The user's display name can appear in the snippet ("Dear 계정"); body words must not rescue an ad.
  assert.equal(classifyEmail(mail('s','Free ChartHub usage reset.','noreply@charts.example.com',['INBOX','CATEGORY_PROMOTIONS'],{snippet:'Dear 계정, account'})).decision,'delete');
});

function fakeGmail(pages){
  const calls=[];const trashed=new Set();
  const call=async(_q,{name,args})=>{
    calls.push({name,args});
    if(name==='gmail.search_emails'){
      const page=Number(args.next_page_token||0);
      const emails=(pages[page]||[]).filter(m=>!trashed.has(m.id));
      return JSON.stringify({emails,next_page_token:pages[page+1]?String(page+1):null});
    }
    if(name==='gmail.delete_emails'){
      for(const id of args.message_ids)trashed.add(id);
      return JSON.stringify({responses:args.message_ids.map(message_id=>({message_id,success:true}))});
    }
    if(name==='gmail.search_email_ids'){
      const all=pages.flat().filter(m=>!trashed.has(m.id)).map(m=>m.id);
      return JSON.stringify({message_ids:all,next_page_token:null});
    }
    throw Error('unexpected '+name);
  };
  return {call,calls,trashed};
}

test('preview reads every page, apply trashes exactly the delete list and verifies it left the inbox',async()=>{
  const pages=[[mail('ad1','Weekly digest','news@a.com',['INBOX','CATEGORY_PROMOTIONS']),mail('sec','보안 알림: 새 로그인','no-reply@accounts.google.com',['INBOX'])],
    [mail('ad2','할인 쿠폰 도착','event@b.co.kr',['INBOX','CATEGORY_PROMOTIONS']),mail('hm','안녕하세요','friend@c.com',['INBOX','CATEGORY_PERSONAL'])]];
  const gmail=fakeGmail(pages);const store=new Map();
  const preview=JSON.parse(await inboxCleanup({mode:'preview'},gmail.call,store));
  assert.equal(preview.scanned,4);
  assert.deepEqual(preview.delete.map(m=>m.id).sort(),['ad1','ad2']);
  assert.deepEqual(preview.keep.map(m=>m.id),['sec']);
  assert.deepEqual(preview.unsure.map(m=>m.id),['hm']);
  assert.equal(gmail.calls.some(c=>c.name==='gmail.delete_emails'),false,'preview must not delete');
  const applied=JSON.parse(await inboxCleanup({mode:'apply',plan_id:preview.plan_id},gmail.call,store));
  assert.deepEqual([...gmail.trashed].sort(),['ad1','ad2']);
  assert.equal(applied.trashed,2);
  assert.deepEqual(applied.still_in_inbox,[]);
  assert.equal(applied.kept_untouched,2);
});

test('apply refuses an unknown plan and lets the user drop or add ids only from the preview',async()=>{
  const gmail=fakeGmail([[mail('ad1','Newsletter','n@a.com',['INBOX','CATEGORY_PROMOTIONS']),mail('sec','Security alert','x@y.com',['INBOX']),mail('hm','hi','f@c.com',['INBOX'])]]);
  const store=new Map();
  await assert.rejects(()=>inboxCleanup({mode:'apply',plan_id:'nope'},gmail.call,store),/미리보기/);
  const preview=JSON.parse(await inboxCleanup({mode:'preview'},gmail.call,store));
  await assert.rejects(()=>inboxCleanup({mode:'apply',plan_id:preview.plan_id,also_delete:['sec']},gmail.call,store),/보존/);
  await assert.rejects(()=>inboxCleanup({mode:'apply',plan_id:preview.plan_id,also_delete:['made-up']},gmail.call,store),/미리보기/);
  await inboxCleanup({mode:'apply',plan_id:preview.plan_id,keep:['ad1'],also_delete:['hm']},gmail.call,store);
  assert.deepEqual([...gmail.trashed],['hm']);
});

test('the cleanup tool is read-only in preview so only apply needs approval',()=>{
  assert.equal(INBOX_CLEANUP.name,'gmail.inbox_cleanup');
  assert.match(INBOX_CLEANUP.description,/preview/);
});

test('a comma string or a lone id becomes the array the schema asks for, before validation',()=>{
  const schema={type:'object',properties:{message_ids:{type:'array',items:{type:'string'}}},required:['message_ids']};
  assert.deepEqual(coerceArguments(schema,{message_ids:'a1, b2,c3'}),{message_ids:['a1','b2','c3']});
  assert.deepEqual(coerceArguments(schema,{message_ids:'a1'}),{message_ids:['a1']});
  assert.deepEqual(coerceArguments(schema,{ids:['a1']}),{message_ids:['a1']});
  const nullable={type:'object',properties:{label_ids:{anyOf:[{type:'array',items:{type:'string'}},{type:'null'}]}}};
  assert.deepEqual(coerceArguments(nullable,{label_ids:'INBOX'}),{label_ids:['INBOX']});
  assert.equal(argumentProblem('gmail.delete_emails',schema,coerceArguments(schema,{message_ids:'a,b'})),'');
  const read={type:'object',properties:{message_id:{type:'string'}},required:['message_id']};
  assert.deepEqual(coerceArguments(read,{ids:['only']}),{message_id:'only'});
});

test('a retry of an approved service call with the same or fewer targets does not ask again',async()=>{
  const ledger=new TaskApproval();let cards=0;const ask=async()=>{cards++;return true;};
  const base=ids=>({request:'메일 정리',description:'삭제',action:{tool:'plugin_call',path:'gmail.delete_emails',args:{message_ids:ids}}});
  await ledger.authorize(base(['a','b','c']),ask,async()=>false);
  await ledger.authorize(base(['a','b']),ask,async()=>false);
  await ledger.authorize(base(['c']),ask,async()=>false);
  assert.equal(cards,1);
  await ledger.authorize(base(['d']),ask,async()=>false);
  assert.equal(cards,2);
});

test('"approve all for this task" covers later calls of that service tool only',async()=>{
  const ledger=new TaskApproval();let cards=0;
  const ask=async()=>{cards++;ledger.approveToolForTask('gmail.delete_emails');return true;};
  const call=(path,ids)=>({request:'메일 정리',description:'삭제',action:{tool:'plugin_call',path,args:{message_ids:ids}}});
  await ledger.authorize(call('gmail.delete_emails',['a']),ask,async()=>false);
  await ledger.authorize(call('gmail.delete_emails',['x','y']),ask,async()=>false);
  assert.equal(cards,1);
  await ledger.authorize(call('gmail.send_email',['x']),ask,async()=>false);
  assert.equal(cards,2);
  ledger.reset();
  await ledger.authorize(call('gmail.delete_emails',['z']),ask,async()=>false);
  assert.equal(cards,3,'a new request starts without the blanket approval');
});

test('the opening announcement says how the work will be done before it starts',()=>{
  const sent=[];
  announceWork(x=>sent.push(x),['plugin_call'],['메일 목록 미리보기','삭제 실행','결과 확인'],{nickname:'빠다',goal:'광고 메일을 정리'});
  assert.match(sent[0],/^작업 계획 · 빠다씨, 광고 메일을 정리/);
  assert.match(sent[0],/서비스 도구/);
  assert.match(sent[0],/1\. 메일 목록 미리보기/);
});
