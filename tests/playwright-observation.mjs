import test from 'node:test';
import assert from 'node:assert/strict';
import * as policy from '../playwright-observation.mjs';

test('live Playwright ref schema rejects stale refs before mutation',()=>{
  assert.doesNotThrow(()=>policy.validateSnapshotTarget({ref:'e3'},{properties:{ref:{type:'string'}}},'- button 저장 [ref=e3]'));
  assert.throws(()=>policy.validateSnapshotTarget({ref:'e2'},{properties:{ref:{type:'string'}}},'- button 저장 [ref=e3]'),/현재/);
  assert.throws(()=>policy.validateSnapshotTarget({target:'e2'},{properties:{target:{type:'string'}}},'- button 저장 [ref=e20]'),/현재/);
});

test('final Playwright success requires a literal quote from current snapshot',async()=>{
  const base={request:'저장 결과 확인',answer:'저장했습니다.',snapshot:'Document saved: example.txt',history:[{tool:'browser_click'}]};
  assert.equal(await policy.verifyBrowserResult({...base,chat:async()=>JSON.stringify({verified:true,quote:'Document saved: example.txt'})}),true);
  assert.equal(await policy.verifyBrowserResult({...base,chat:async()=>JSON.stringify({verified:true,quote:'Document saved: another.txt'})}),false);
  assert.equal(await policy.verifyBrowserResult({...base,chat:async()=>'{"verified":true}'}),false);
});
