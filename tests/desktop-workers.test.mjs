import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DesktopWorkers } from '../build/server/desktop-workers.mjs';

test('an accessibility provider cannot queue input/control work behind itself', async()=>{
  let finishObservation;
  const observation={call:()=>new Promise(resolve=>finishObservation=resolve),stop(){}};
  const control={call:async()=>({result:'control responsive'}),stop(){}};
  const workers=new DesktopWorkers({observation,control});
  const pending=workers.call('ui_tree',{handle:42});
  assert.deepEqual(await workers.call('ping'),{result:'control responsive'});
  finishObservation({result:'tree'});
  assert.deepEqual(await pending,{result:'tree'});
});

test('accessibility reads and mutations keep their cache in one bounded worker',async()=>{
  const calls=[];
  const observation={call:async(op,args,options)=>{calls.push({op,options});return {result:{}};},stop(){}};
  const control={call:async()=>assert.fail('UIA must stay isolated'),stop(){}};
  const workers=new DesktopWorkers({observation,control});
  for(const op of ['ui_tree','invoke_element','set_element_value']) await workers.call(op,{});
  assert.deepEqual(calls.map(c=>c.options.timeoutMs),[2000,2000,2000]);
  await workers.call('ui_tree',{}, {timeoutMs:500});
  assert.equal(calls.at(-1).options.timeoutMs,500);
});

test('stopping a desktop session closes both workers',()=>{
  const stopped=[];
  const workers=new DesktopWorkers({control:{stop(){stopped.push('control');}},observation:{stop(){stopped.push('observation');}}});
  workers.stop();
  assert.deepEqual(stopped,['control','observation']);
});
