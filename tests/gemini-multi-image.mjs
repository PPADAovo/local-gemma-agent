import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {sessionComplete,utilityComplete,closeSession,buildTurn} from '../gemini-session.mjs';

const images=['reference A','reference B','current screen'].map(s=>Buffer.from(s).toString('base64'));
const messages=()=>[{role:'system',content:'Follow instructions.'},{role:'user',content:'Preserved user requirement',keep:true},{role:'user',content:'Latest result'}];
const format={type:'object',properties:{tool:{type:'string'},text:{type:'string'}},required:['tool','text']};
function fakeCli(){
  const spawned=[],sent=[];
  const spawnProcess=()=>{
    const child=new EventEmitter();
    Object.assign(child,{stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough(),kill(){this.killed=true;}});
    child.stdin.on('data',chunk=>{
      const prompt=JSON.parse(String(chunk)).message.content;
      sent.push({prompt});
      queueMicrotask(()=>child.stdout.write(JSON.stringify({event:'result',result:{status:'SUCCESS',structured_output:{tool:'reply',text:'step '+sent.length}}})+'\n'));
    });
    queueMicrotask(()=>child.stdout.write('{"event":"init"}\n'));spawned.push(child);return child;
  };
  return {spawned,sent,spawnProcess};
}
for(const mode of ['session','utility'])test('Gemini '+mode+' rejects unsupported image input before launching headless',async t=>{
  const cli=fakeCli();
  t.after(()=>{closeSession();for(const child of cli.spawned)child.emit('close',0);});
  await assert.rejects((mode==='session'?sessionComplete:utilityComplete)([{role:'user',content:'Compare references',images}],format,{exe:'fixture',spawnProcess:cli.spawnProcess}),error=>error.code==='VISION_UNSUPPORTED');
  assert.equal(cli.spawned.length,0);
});

test('revised preserved instructions reach a text-only Gemini session',async t=>{
  const cli=fakeCli(),history=messages();t.after(()=>closeSession());
  const first=await sessionComplete(history,format,{exe:'fixture',model:'reference-text-invalidation',spawnProcess:cli.spawnProcess});
  history[1]={...history[1],content:'The SECOND reference is the target; the first is the old design.'};
  history.push({role:'assistant',content:first},{role:'user',content:'Continue.'});
  await sessionComplete(history,format,{exe:'fixture',model:'reference-text-invalidation',spawnProcess:cli.spawnProcess});
  assert.match(cli.sent[1].prompt,/The SECOND reference is the target/);
  assert.equal(cli.spawned.length,2);
});

test('revised system instructions are delivered before continuing the same message history',async t=>{
  const cli=fakeCli(),history=messages();t.after(()=>closeSession());
  const first=await sessionComplete(history,format,{exe:'fixture',model:'system-invalidation',spawnProcess:cli.spawnProcess});
  history[0]={role:'system',content:'Inspect only. Do not edit the active project.'};
  history.push({role:'assistant',content:first},{role:'user',content:'Continue.'});
  await sessionComplete(history,format,{exe:'fixture',model:'system-invalidation',spawnProcess:cli.spawnProcess});
  assert.match(cli.sent[1].prompt,/Inspect only\. Do not edit the active project\./);
});

test('text-only prompt builder never represents image files as delivered attachments',()=>{
  const message={role:'user',content:'Frame',images:[images[0]]};
  assert.throws(()=>buildTurn({messages:[message,message],from:0,format}),error=>error.code==='VISION_UNSUPPORTED');
});

test('text-only prompt builder rejects assistant images even if text is a repeated reply',()=>{
  assert.throws(()=>buildTurn({messages:[{role:'assistant',content:'done',images:[images[0]]}],from:0,format,lastReply:'done'}),error=>error.code==='VISION_UNSUPPORTED');
});
