import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('a model that hit its quota is skipped until the reset time, and the next model is used',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'quota-'));
  const saved=process.env.LOCALAPPDATA;process.env.LOCALAPPDATA=dir;
  try{
    const q=await import('../gemini-quota.mjs?'+Date.now());
    const now=Date.parse('2026-11-15T12:00:00Z');
    assert.equal(q.isQuotaError('Individual quota reached. Please upgrade your subscription to increase your limits. Resets in 147h22m51s.'),true);
    assert.equal(q.isQuotaError('Malformed function call'),false);
    assert.equal(q.resetAt('Resets in 147h22m51s.',now),now+((147*60+22)*60+51)*1000);
    assert.deepEqual(q.usableModels('',now),q.MODEL_CHAIN);
    q.markExhausted('','Individual quota reached. Resets in 2h.',now);
    assert.deepEqual(q.usableModels('',now),q.MODEL_CHAIN.slice(1));
    assert.match(q.quotaNote(now),/기본 모델 2시간 뒤 풀림/);
    // 풀린 뒤에는 다시 기본 모델부터 씁니다.
    assert.deepEqual(q.usableModels('',now+3*3600e3),q.MODEL_CHAIN);
    // 모두 막혀도 빈 목록 대신 마지막 모델 하나는 시도합니다.
    for(const m of q.MODEL_CHAIN)q.markExhausted(m,'quota reached. Resets in 1h',now);
    assert.equal(q.usableModels('',now).length,1);
  }finally{process.env.LOCALAPPDATA=saved;fs.rmSync(dir,{recursive:true,force:true});}
});
