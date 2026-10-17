import assert from 'node:assert/strict';
import {test} from 'node:test';

test('installer verification waits for native exit before retrying and before reporting success',async()=>{
  const {checkProtectedHelper}=await import('../build/server/helper-check.mjs');
  let calls=0,stops=0,exits=0;
  const helper={call:async()=>{
    calls++;if(calls===1)throw Object.assign(new Error('startup unavailable'),{code:'HELPER_UNAVAILABLE'});
    assert.equal(exits,1,'the previous candidate must be gone before retry');
    return {result:{uiAccess:true,capabilities:{preparedInput:true}}};
  },stop(){stops++;},waitForStop:async()=>{await new Promise(resolve=>setImmediate(resolve));exits++;}};
  const result=await checkProtectedHelper(helper);
  assert.equal(result.uiAccess,true);assert.equal(stops,2);assert.equal(exits,2);
});
