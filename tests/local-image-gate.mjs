import test from 'node:test';
import assert from 'node:assert/strict';
import * as gate from '../local-first-runtime.mjs';
test('external image generation requires an observed local capability limitation',()=>{
  assert.throws(()=>gate.assertExternalImageFallback({},null),/discover_tools/);
  assert.throws(()=>gate.assertExternalImageFallback({},{available:true,reason:'installed'}),/로컬/);
  assert.doesNotThrow(()=>gate.assertExternalImageFallback({},{available:false,reason:'No connected local image adapter'}));
  assert.doesNotThrow(()=>gate.assertExternalImageFallback({localFirst:false},null));
});
