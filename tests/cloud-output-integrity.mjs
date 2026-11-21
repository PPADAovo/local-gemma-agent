import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {chat} from '../cloud-brain.mjs';

for(const provider of ['gemini','claude','gpt'])for(const alwaysCut of [false,true])test(`${provider} output limit is detected before delivering an incomplete answer (${alwaysCut})`,async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cloud-output-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const file=path.join(dir,'config.json');await fs.writeFile(file,JSON.stringify({order:[provider],[provider]:{key:'fixture-not-a-real-key',models:alwaysCut?['fixture','fallback']:['fixture'],url:'https://fixture.invalid'},maxOutputTokens:4096}));
  const old=globalThis.fetch;const budgets=[];t.after(()=>{globalThis.fetch=old;});
  globalThis.fetch=async(_url,options)=>{
    const body=JSON.parse(options.body);budgets.push(body.generationConfig?.maxOutputTokens||body.max_tokens||body.max_completion_tokens);
    const cut=alwaysCut||budgets.length===1,text=cut?'잘린 답변':'완성된 답변';
    return Response.json(provider==='gemini'?{candidates:[{finishReason:cut?'MAX_TOKENS':'STOP',content:{parts:[{text}]}}]}:provider==='claude'?{stop_reason:cut?'max_tokens':'end_turn',content:[{type:'text',text}]}:{choices:[{finish_reason:cut?'length':'stop',message:{content:text}}]});
  };
  const request=()=>chat([{role:'user',content:'자료 설명'}],{file,provider});
  if(alwaysCut){await assert.rejects(request,/출력|잘렸|한도/);assert.ok(budgets.length<=3);}
  else{assert.equal((await request()).text,'완성된 답변');assert.deepEqual(budgets,[4096,8192]);}
});
