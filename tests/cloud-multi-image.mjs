import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';

test('cloud API transports preserve reference images and current capture in message order',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cloud-multi-image-'));
  const originalFetch=globalThis.fetch;
  t.after(async()=>{globalThis.fetch=originalFetch;await fs.rm(dir,{recursive:true,force:true});});
  for(const file of ['cloud-brain.mjs','context-size.mjs','brain-health.mjs','app-data.mjs'])await fs.copyFile(new URL('../'+file,import.meta.url),path.join(dir,file));
  const config=path.join(dir,'config.json');
  await fs.writeFile(config,JSON.stringify(Object.fromEntries(['gemini','claude','gpt'].map(p=>[p,{key:'synthetic-test-key',models:['fixture-model'],url:'https://fixture.invalid'}]))));
  const {chat}=await import(pathToFileURL(path.join(dir,'cloud-brain.mjs')));
  const refs=['reference A','reference B'].map(s=>Buffer.from(s).toString('base64'));
  const screen=Buffer.from('current screenshot').toString('base64');
  const messages=[{role:'user',content:'Compare these two references.',images:refs,keep:true},
    {role:'user',content:'Current screen to compare.',images:[screen]}];
  for(const provider of ['gemini','claude','gpt']){
    await t.test(provider,async()=>{
      let body;
      globalThis.fetch=async(_url,options)=>{body=JSON.parse(options.body);return {ok:true,text:async()=>JSON.stringify({candidates:[{content:{parts:[{text:'ok'}]}}],choices:[{message:{content:'ok'}}],content:[{type:'text',text:'ok'}]})};};
      await chat(messages,{provider,file:config});
      const parts=provider==='gemini'?body.contents.flatMap(m=>m.parts):body.messages.flatMap(m=>Array.isArray(m.content)?m.content:[{type:'text',text:m.content}]);
      const actual=parts.flatMap(p=>p.inline_data?[p.inline_data.data]:p.type==='image'?[p.source.data]:p.type==='image_url'?[p.image_url.url.split(',')[1]]:[]);
      assert.deepEqual(actual,[...refs,screen]);
      const order=parts.map(p=>p.text||p.inline_data?.data||p.source?.data||p.image_url?.url.split(',')[1]);
      assert.deepEqual(order,['Compare these two references.',...refs,'Current screen to compare.',screen],'image context must stay adjacent even when consecutive user messages are merged');
    });
    await t.test(provider+' image-only messages omit invalid empty text blocks',async()=>{
      let body;
      globalThis.fetch=async(_url,options)=>{body=JSON.parse(options.body);return {ok:true,text:async()=>JSON.stringify({candidates:[{content:{parts:[{text:'ok'}]}}],choices:[{message:{content:'ok'}}],content:[{type:'text',text:'ok'}]})};};
      await chat([{role:'user',content:'',images:refs},{role:'user',content:' \n ',images:[screen]}],{provider,file:config});
      const parts=provider==='gemini'?body.contents.flatMap(m=>m.parts):body.messages.flatMap(m=>m.content);
      assert.equal(parts.some(p=>typeof p.text==='string'&&!p.text.trim()),false,'image-only messages must not contain empty text blocks');
      const actual=parts.flatMap(p=>p.inline_data?[p.inline_data.data]:p.type==='image'?[p.source.data]:p.type==='image_url'?[p.image_url.url.split(',')[1]]:[]);
      assert.deepEqual(actual,[...refs,screen]);
    });
  }
  await t.test('long history retains reference image context',async()=>{
    let body;
    globalThis.fetch=async(_url,options)=>{body=JSON.parse(options.body);return {ok:true,text:async()=>JSON.stringify({candidates:[{content:{parts:[{text:'ok'}]}}]})};};
    const long=[messages[0],...Array.from({length:20},(_,i)=>({role:i%2?'user':'assistant',content:'history '+i+' '+'x'.repeat(7990)})),messages[1]];
    await chat(long,{provider:'gemini',file:config});
    const actual=body.contents.flatMap(m=>m.parts).flatMap(p=>p.inline_data?[p.inline_data.data]:[]);
    assert.deepEqual(actual,[...refs,screen],'text compaction must not silently discard visual task requirements');
  });
});
