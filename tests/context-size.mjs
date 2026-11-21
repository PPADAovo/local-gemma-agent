import test from 'node:test';
import assert from 'node:assert/strict';
import {estimateTokens,chooseContext,nextContext,cutByContext,memoryProfile,memoryContextCap,memoryNeedGB} from '../context-size.mjs';

test('the context grows with what is sent and never shrinks below what is loaded',()=>{
  const small=estimateTokens([{content:'가'.repeat(2000)}]);
  // 작은 요청도 기본 크기(32K)로 보내 작업 중 크기가 바뀌어 모델을 다시 불러오는 일을 막습니다.
  assert.equal(chooseContext({estimate:small,predict:2048}),32768);
  assert.equal(chooseContext({estimate:small,predict:2048,max:8192}),8192);
  assert.equal(chooseContext({estimate:20000,predict:2048}),32768);
  assert.equal(chooseContext({estimate:small,predict:2048,floor:32768}),32768);
  assert.equal(chooseContext({estimate:200000,predict:2048,max:65536}),65536);
  assert.ok(estimateTokens([{content:'',images:['x']}])>=1000);
});

test('a cut-off answer is told apart from an answer-length limit',()=>{
  assert.equal(cutByContext({done_reason:'length',prompt_eval_count:16000,eval_count:300},16384),true);
  assert.equal(cutByContext({done_reason:'length',prompt_eval_count:2000,eval_count:2048},16384),false);
  assert.equal(cutByContext({done_reason:'stop',prompt_eval_count:16300,eval_count:80},16384),false);
  assert.equal(nextContext(16384,65536),32768);
  assert.equal(nextContext(65536,65536),null);
});

test('per-token memory follows the model structure and caps the context by free memory',()=>{
  const gemma={'general.architecture':'gemma4','gemma4.block_count':6,'gemma4.attention.head_count_kv':[8,8,8,8,8,1],'gemma4.attention.key_length':512,'gemma4.attention.value_length':512,'gemma4.attention.sliding_window':1024};
  const p=memoryProfile(gemma);
  assert.equal(p.perToken,1*1024*2);       // 전체를 보는 층 1개만 토큰마다 늘어남
  assert.equal(p.fixed,5*8*1024*2*1024);   // 나머지 5층은 1,024토큰 고정
  const qwen=memoryProfile({'general.architecture':'qwen35moe','qwen35moe.block_count':40,'qwen35moe.attention.head_count_kv':2,'qwen35moe.attention.key_length':256,'qwen35moe.attention.value_length':256,'qwen35moe.full_attention_interval':4});
  assert.equal(qwen.perToken,10*2*512*2);
  const cap=memoryContextCap({availableGB:20,sizeGB:17.4,profile:{perToken:20480,fixed:0},margin:1.5});
  assert.ok(cap>50000 && cap<60000);
  assert.equal(memoryContextCap({availableGB:10,sizeGB:17.4,profile:{perToken:20480,fixed:0}}),0);
  assert.ok(Math.abs(memoryNeedGB(7.5,{perToken:16384,fixed:0},32768)-8.0)<0.01);
});
