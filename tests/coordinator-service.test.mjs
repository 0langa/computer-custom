import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { CoordinatorService } from '../build/server/coordinator-service.mjs';
import { CoordinatorConnection, listenCoordinator } from '../build/server/coordinator-ipc.mjs';
import { DEFAULT_DESKTOP_SETTINGS } from '../build/server/desktop-settings.mjs';

const target={handle:101,pid:12,processStartTime:'1'};
const action={op:'click',target,args:{x:10,y:10}};
const fakeWorker=()=>({call:async(op,args)=>({result:op==='resolve_target'?{...args.target,x:0,y:0,width:300,height:200}:{capabilities:{preparedInput:true}}}),stop(){}});
async function setup(run){
  const service=new CoordinatorService({settings:{...DEFAULT_DESKTOP_SETTINGS,countdownMs:0},
    createWorkers:fakeWorker,run,showNotice:async()=>{},hideNotice:async()=>{}});
  const address={pipePath:`\\\\.\\pipe\\cc-service-test.${randomUUID()}`,secret:randomUUID()};
  const server=await listenCoordinator({...address,dispatch:(...args)=>service.dispatch(...args),
    onDisconnect:owner=>service.disconnect(owner),onCancelRequest:(owner,id)=>service.cancelRequest(owner,id)});
  const a=new CoordinatorConnection(address),b=new CoordinatorConnection(address);
  return {service,a,b,close:async()=>{a.close();b.close();await server.close();service.close();}};
}
test('two IPC clients serialize real queue ownership and share snooze',async()=>{
  let concurrent=0,max=0;const owners=[];
  const s=await setup(async(workers,batch,signal,progress)=>{concurrent++;max=Math.max(max,concurrent);owners.push(batch.owner);await delay(20);progress(1);concurrent--;});
  try {
    const resume=(await s.a.request('snooze',{})).result.resumeAt;
    const [a,b]=await Promise.all([s.a.request('prepare',{actions:[action],flush:true}),s.b.request('prepare',{actions:[action],flush:true})]);
    await delay(5);
    assert.equal((await s.a.request('batch_status',{id:a.result.id})).result.resumeAt,resume);
    assert.equal((await s.b.request('batch_status',{id:b.result.id})).result.resumeAt,resume);
    assert.equal(owners.length,0);
    await assert.rejects(s.b.request('batch_status',{id:a.result.id}),/not found/i);
  }finally{await s.close();}
  const t=await setup(async(workers,batch,signal,progress)=>{concurrent++;max=Math.max(max,concurrent);owners.push(batch.owner);await delay(20);progress(1);concurrent--;});
  try {
    const [a,b]=await Promise.all([t.a.request('prepare',{actions:[action],flush:true}),t.b.request('prepare',{actions:[action],flush:true})]);
    for(const [client,batch] of [[t.a,a.result],[t.b,b.result]]){
      let status=batch;while(!['succeeded','failed','cancelled'].includes(status.state))status=(await client.request('wait_batch',{id:batch.id,afterRevision:status.revision})).result;
      assert.equal(status.state,'succeeded');assert.equal(status.completed,1);
    }
    assert.equal(max,1);assert.notEqual(owners[0],owners[1]);
  }finally{await t.close();}
});
test('invalid actions and direct native input cannot bypass preparation',async()=>{
  let runs=0;const s=await setup(async()=>{runs++;});
  try{
    await assert.rejects(s.a.request('native',{op:'click',args:{x:1,y:1}}),/prepared/i);
    await assert.rejects(s.a.request('prepare',{actions:[{...action,args:{x:'bad',y:1}}],flush:true}),/number|invalid/i);
    assert.equal(runs,0);
  }finally{await s.close();}
});
test('cancellation arriving after prepare returned still cancels that request batch',async()=>{
  let runs=0;const s=await setup(async()=>{runs++;});
  try{
    const response=await s.service.dispatch('owner','prepare',{actions:[action]},new AbortController().signal,42);
    s.service.cancelRequest('owner',42);
    assert.equal((await s.service.dispatch('owner','batch_status',{id:response.result.id},new AbortController().signal,43)).result.state,'cancelled');
    assert.equal(runs,0);
  }finally{await s.close();}
});

test('each owner retains its own requested helper and elevation mode',async()=>{
  const requested=[];
  const service=new CoordinatorService({settings:DEFAULT_DESKTOP_SETTINGS,showNotice:async()=>{},hideNotice:async()=>{},
    createWorkers:options=>{requested.push(options);return fakeWorker();}});
  const signal=new AbortController().signal;
  try{
    await service.dispatch('a','hello',{helper:{elevated:true,executablePath:'a.exe'}},signal,1);
    await service.dispatch('b','hello',{helper:{elevated:false,executablePath:'b.exe'}},signal,2);
    await service.dispatch('a','native',{op:'ping'},signal,3);await service.dispatch('b','native',{op:'ping'},signal,4);
    assert.deepEqual(requested,[{elevated:true,executablePath:'a.exe'},{elevated:false,executablePath:'b.exe'}]);
  }finally{service.close();}
});
