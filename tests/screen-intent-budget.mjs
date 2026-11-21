import test from 'node:test';
import assert from 'node:assert/strict';
import {structuredInferencePolicy} from '../local-inference-policy.mjs';
test('selected-window intent classification uses a bounded control decision',()=>{
  const format={type:'object',properties:{intent:{enum:['inspect','operate','other']}},required:['intent']};
  const policy=structuredInferencePolicy(format);
  assert.equal(policy?.purpose,'request-routing');
  assert.equal(policy?.tokens,1024);
  assert.equal(policy?.timeoutMs,60000);
  assert.equal(structuredInferencePolicy({type:'object',properties:{intent:{type:'string'},document:{type:'string'}}}),null);
});
