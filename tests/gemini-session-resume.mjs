import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {sessionComplete,closeSession} from '../gemini-session.mjs';

// 가짜 CLI: 보낸 글을 모두 기록하고, 받을 때마다 정해진 답을 돌려줍니다.
function fakeCli(){
  const spawned=[],sent=[];
  const spawnProcess=()=>{
    const child=new EventEmitter();
    Object.assign(child,{stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough(),kill(){this.killed=true;}});
    let buffer='';
    child.stdin.on('data',chunk=>{
      buffer+=chunk;let at;
      while((at=buffer.indexOf('\n'))>=0){
        const line=buffer.slice(0,at);buffer=buffer.slice(at+1);
        sent.push(JSON.parse(line).message.content);
        queueMicrotask(()=>child.stdout.write(JSON.stringify({event:'result',result:{status:'SUCCESS',structured_output:{tool:'reply',text:'step '+sent.length}}})+'\n'));
      }
    });
    queueMicrotask(()=>child.stdout.write('{"event":"init"}\n'));
    spawned.push(child);
    return child;
  };
  return {spawned,sent,spawnProcess};
}
const format={type:'object',properties:{tool:{type:'string'},text:{type:'string'}},required:['tool','text']};

test('trimming or summarizing earlier messages keeps the same session and sends only what is new',async t=>{
  t.after(()=>closeSession());
  const cli=fakeCli();
  const messages=[{role:'system',content:'지시문'},{role:'user',content:'요청'},{role:'user',content:'도구 결과 1 '+'가'.repeat(3000)}];
  const first=await sessionComplete(messages,format,{exe:'fixture',spawnProcess:cli.spawnProcess});
  assert.equal(JSON.parse(first).text,'step 1');
  // 프로그램이 오래된 도구 결과를 줄이고(내용이 바뀜), 새 결과를 덧붙입니다.
  messages[2]={role:'user',content:'도구 결과 1 (줄임)'};
  messages.push({role:'assistant',content:first},{role:'user',content:'도구 결과 2'});
  // 마지막으로 보냈던 메시지가 줄어 찾을 수 없으면 새로 열어야 하므로, 이 시험에서는 그 메시지를 그대로 둡니다.
  messages[2]={role:'user',content:'도구 결과 1 '+'가'.repeat(3000)};
  messages[1]={role:'user',content:'요청 (요약됨)'};
  await sessionComplete(messages,format,{exe:'fixture',spawnProcess:cli.spawnProcess});
  assert.equal(cli.spawned.length,1,'세션을 새로 열지 않음');
  assert.match(cli.sent[1],/도구 결과 2/);
  assert.doesNotMatch(cli.sent[1],/가{100}/,'이미 보낸 긴 결과는 다시 보내지 않음');
  assert.doesNotMatch(cli.sent[1],/step 1/,'Gemini가 한 답은 다시 보내지 않음');
});

test('when the last sent message is gone, a fresh session receives the whole conversation',async t=>{
  t.after(()=>closeSession());
  const cli=fakeCli();
  const messages=[{role:'system',content:'지시문'},{role:'user',content:'요청'},{role:'user',content:'도구 결과 1'}];
  await sessionComplete(messages,format,{exe:'fixture',spawnProcess:cli.spawnProcess});
  const summarized=[messages[0],{role:'user',content:'[앞선 진행 요약]'},{role:'user',content:'도구 결과 2'}];
  await sessionComplete(summarized,format,{exe:'fixture',spawnProcess:cli.spawnProcess});
  assert.equal(cli.spawned.length,2);
  assert.match(cli.sent[1],/지시문/);
  assert.match(cli.sent[1],/앞선 진행 요약/);
});
