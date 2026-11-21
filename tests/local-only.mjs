import test from 'node:test';
import assert from 'node:assert/strict';
import {availableTools} from '../agent-loop.mjs';
import {createLocalFirstPolicy} from '../local-first-runtime.mjs';

test('the model is never offered a tool to ask Gemini, in local or mixed mode',()=>{
  for(const brain of ['local','mix',undefined])assert.ok(!availableTools({brain,computerUse:true,webMode:'always'}).includes('ask_gemini'),String(brain));
});

test('local-only never silently chooses an unconfigured external provider',()=>{
  const policy=createLocalFirstPolicy({brain:'local'});
  assert.equal(policy.escalate('로컬 모델이 실패했습니다'),false);
  assert.equal(policy.external,false);
});
