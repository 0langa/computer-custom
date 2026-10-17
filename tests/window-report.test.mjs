import assert from 'node:assert/strict';
import {test} from 'node:test';
import report from '../flows/window-report.mjs';
const windows=[{process:'ordinary',integrity:'medium',width:400,height:300},{process:'elevated',integrity:'high',width:400,height:300}];
const context=status=>({status:async()=>status,list_windows:async()=>windows,args:{},log(){}});
test('window report includes elevated candidates when actual helper privileges permit them',async()=>{
  const result=await report(context({power:'high',integrity:'high',uiAccess:true}));
  assert.deepEqual(result.drivable.map(w=>w.process),['ordinary','elevated']);assert.equal(result.outOfReach,0);
});
test('a normal helper report still identifies higher-integrity input targets as unavailable',async()=>{
  const result=await report(context({power:'medium',integrity:'medium',uiAccess:false}));
  assert.deepEqual(result.drivable.map(w=>w.process),['ordinary']);assert.equal(result.outOfReach,1);
});
