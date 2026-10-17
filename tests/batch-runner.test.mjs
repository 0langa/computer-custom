import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runPreparedBatch } from '../build/server/batch-runner.mjs';
const target={handle:1,pid:2,processStartTime:'3'};
const batch={settings:{inputMode:'block',maxControlMs:10000},actions:[{op:'click',target,args:{x:10,y:10}},{op:'key',target,args:{keys:['enter']}}]};
function fake(){
  const calls=[];
  const worker={control:{stop:()=>calls.push('stop-control')},observation:{stop:()=>calls.push('stop-uia')},
    call:async(op,args)=>{calls.push({op,args});return {result:op==='begin_control'?{leaseId:'lease'}:{executed:true}};}};
  return {worker,calls};
}
test('one local batch acquires once, reports ordered progress, and releases once',async()=>{
  const {worker,calls}=fake(),progress=[];
  await runPreparedBatch(worker,batch,new AbortController().signal,n=>progress.push(n));
  assert.deepEqual(calls.map(c=>c.op),['begin_control','execute_step','execute_step','end_control']);
  assert.deepEqual(progress,[1,2]);
  assert.equal(calls[1].args.leaseId,'lease');
});
test('cancelling between steps never dispatches the next action or starts a release worker',async()=>{
  const {worker,calls}=fake(),controller=new AbortController();
  await assert.rejects(runPreparedBatch(worker,batch,controller.signal,()=>controller.abort()),e=>e.code==='CANCELLED');
  assert.equal(calls.filter(c=>c.op==='execute_step').length,1);
  assert.ok(calls.includes('stop-control'));
  assert.equal(calls.filter(c=>c.op==='end_control').length,0);
});
test('a failed native step releases input and does not replay or continue',async()=>{
  const {worker,calls}=fake();const original=worker.call;
  worker.call=async(op,args)=>{if(op==='execute_step')throw new Error('target changed');return original(op,args);};
  await assert.rejects(runPreparedBatch(worker,batch,new AbortController().signal,()=>{}),/target changed/);
  assert.deepEqual(calls.map(c=>c.op),['begin_control','end_control']);
});
test('unsupported operations are rejected before input acquisition',async()=>{
  const {worker,calls}=fake();
  await assert.rejects(runPreparedBatch(worker,{...batch,actions:[{op:'run_shell',target,args:{}}]},new AbortController().signal,()=>{}),/Unsupported/);
  assert.deepEqual(calls,[]);
});

test('dependent UIA mutation waits for the prior typed value without replaying input',async()=>{
  const {worker,calls}=fake();let reads=0;const original=worker.call;
  worker.call=async(op,args)=>{
    if(op==='resolve_element'){reads++;calls.push({op,args});return {result:{value:reads<2?'':'typed'}};}
    return original(op,args);
  };
  await runPreparedBatch(worker,{...batch,actions:[{op:'type_text',target,args:{text:'typed'},expect:{elementId:'field',property:'value',equals:'typed'}},
    {op:'set_element_value',target,args:{elementId:'field',value:'next'}}]},new AbortController().signal,()=>{});
  assert.equal(reads,2);assert.equal(calls.filter(c=>c.op==='execute_step'&&c.args.op==='type_text').length,1);
  assert.ok(calls.findLastIndex(c=>c.op==='resolve_element')<calls.findIndex(c=>c.op==='set_element_value'));
});

test('a prepared navigation waits for a new page control before sending the dependent click',async()=>{
  const {worker,calls}=fake();let reads=0;const original=worker.call;
  worker.call=async(op,args)=>{
    if(op==='ui_tree'){reads++;calls.push({op,args});return {result:{root:{name:reads<2?'Loading':'Notifications',role:'button',offscreen:false,children:[]}}};}
    return original(op,args);
  };
  await runPreparedBatch(worker,{...batch,actions:[{op:'key',target,args:{keys:['ctrl',',']}},
    {op:'wait_for',target,args:{name:'Notifications',role:'button'}},batch.actions[0]]},new AbortController().signal,()=>{});
  assert.equal(reads,2);assert.equal(calls.filter(c=>c.op==='execute_step'&&c.args.op==='key').length,1);
  assert.ok(calls.findLastIndex(c=>c.op==='ui_tree')<calls.findIndex(c=>c.op==='execute_step'&&c.args.op==='click'));
});
test('a missing page control times out and releases without sending the dependent click',async()=>{
  const {worker,calls}=fake();const original=worker.call;
  worker.call=async(op,args)=>op==='ui_tree'?{result:{root:{name:'Loading',role:'text',children:[]}}}:original(op,args);
  await assert.rejects(runPreparedBatch(worker,{...batch,actions:[{op:'wait_for',target,args:{name:'Notifications',timeoutMs:40}},batch.actions[0]]},
    new AbortController().signal,()=>{}),e=>e.code==='STATE_TIMEOUT');
  assert.equal(calls.filter(c=>c.op==='execute_step').length,0);assert.equal(calls.at(-1).op,'end_control');
});
test('a navigation invocation resolves its control from the live page rather than an old coordinate',async()=>{
  const {worker,calls}=fake();const original=worker.call;
  worker.call=async(op,args)=>{
    if(op==='ui_tree')return {result:{root:{role:'window',children:[{elementId:'live-button',name:'Notifications',role:'button',enabled:true,offscreen:false,children:[]}]}}};
    return original(op,args);
  };
  await runPreparedBatch(worker,{...batch,actions:[{op:'invoke_element',target,args:{selector:{name:'Notifications',role:'button'}}}]},new AbortController().signal,()=>{});
  assert.deepEqual(calls.find(c=>c.op==='invoke_element').args,{elementId:'live-button',target,prepared:true});
});
test('cancellation cleanup waits for the input worker to exit before returning ownership',async()=>{
  const {worker}=fake(),controller=new AbortController();let release,waiting=false,finished=false;
  worker.control.waitForStop=()=>{waiting=true;return new Promise(resolve=>release=resolve);};
  const result=runPreparedBatch(worker,batch,controller.signal,()=>controller.abort()).catch(error=>{finished=true;return error;});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(waiting,true);assert.equal(finished,false);
  release();assert.equal((await result).code,'CANCELLED');
});

test('internal selector reads preserve observed controls used later in the same batch',async()=>{
  const {worker}=fake();const original=worker.call;let observedValid=true;
  worker.call=async(op,args)=>{
    if(op==='ui_tree'){
      if(!args.internalQuery)observedValid=false;
      return {result:{truncated:false,root:{elementId:'live-button',name:'Apply',role:'button',children:[]}}};
    }
    if((op==='resolve_element'||op==='set_element_value')&&args.elementId==='observed-field'){
      if(!observedValid)throw Object.assign(new Error('observation expired'),{code:'STALE_HANDLE'});
      return {result:{value:'ready'}};
    }
    return original(op,args);
  };
  await runPreparedBatch(worker,{...batch,actions:[
    {op:'invoke_element',target,args:{selector:{name:'Apply'}},expect:{elementId:'observed-field',property:'value',equals:'ready'}},
    {op:'wait_for',target,args:{name:'Apply'}},
    {op:'set_element_value',target,args:{elementId:'observed-field',value:'next'}}
  ]},new AbortController().signal,()=>{});
});

test('a truncated selector tree cannot establish uniqueness or dispatch an invocation',async()=>{
  const {worker,calls}=fake();const original=worker.call;
  worker.call=async(op,args)=>op==='ui_tree'?{result:{truncated:true,root:{elementId:'first',name:'Apply',role:'button',children:[]}}}:original(op,args);
  await assert.rejects(runPreparedBatch(worker,{...batch,actions:[{op:'invoke_element',target,args:{selector:{name:'Apply'}}}]},
    new AbortController().signal,()=>{}),e=>e.code==='INCOMPLETE_TARGET_QUERY');
  assert.equal(calls.filter(c=>c.op==='invoke_element').length,0);
});
