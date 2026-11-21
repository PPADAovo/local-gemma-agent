import test from 'node:test';
import assert from 'node:assert/strict';
import {askCard,browserGate} from '../human-handoff.mjs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const page=(url,body)=>'페이지: 작업\n주소: '+url+'\n본문 일부:\n'+body;
test('public pages and optional login buttons are distinct from account gates',()=>{
  assert.equal(browserGate(page('https://www.youtube.com/','로그인')),undefined);
  assert.equal(browserGate(page('https://accounts.google.com/signin/v2','Choose an account')),undefined);
  assert.equal(browserGate(page('https://accounts.google.com/signin/v2','[input:password]')).kind,'input');
  for(const [url,body,kind] of [
    ['https://accounts.google.com/challenge/x','휴대전화에서 확인','input'],
    ['https://accounts.google.com/signin/oauth/consent','액세스 요청','approval'],
    ['https://accounts.google.com/signin/rejected','이 브라우저 또는 앱이 안전하지 않을 수 있습니다.','blocked']
  ])assert.equal(browserGate(page(url,body)).kind,kind);
});
test('a request waits for its own answer without consuming a different user instruction',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gemma-card-')),file=path.join(dir,'input');
 try{
  let id;const pending=askCard({kind:'approve',question:'승인할까요?'},file,line=>{
    if(line.startsWith('@ask '))id=JSON.parse(line.slice(5)).askId;
  });
  await fs.writeFile(file,JSON.stringify({askId:'other',answer:'승인'})+'\n');
  await fs.appendFile(file,JSON.stringify({askId:id,answer:'거부'})+'\n');
  assert.equal(await pending,'거부');
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
