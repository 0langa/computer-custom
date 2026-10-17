import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { CoordinatorConnection, listenCoordinator } from '../build/server/coordinator-ipc.mjs';
const endpoint=()=>({pipePath:`\\\\.\\pipe\\cc-coordinator-test.${randomUUID()}`,secret:randomUUID()});

test('independent authenticated sessions share the service without sharing identity or binary results',async()=>{
  const address=endpoint();
  const server=await listenCoordinator({...address,dispatch:async(owner,method,args)=>{
    if(method==='image'){await delay(args.delay);return {result:{owner,label:args.label},binary:Buffer.from(args.label)};}
    return {result:{owner}};
  }});
  const a=new CoordinatorConnection(address),b=new CoordinatorConnection(address);
  try {
    const [ra,rb]=await Promise.all([a.request('identity',{}),b.request('identity',{})]);
    assert.notEqual(ra.result.owner,rb.result.owner);
    const results=await Promise.all([a.request('image',{label:'first',delay:30}),a.request('image',{label:'second',delay:1})]);
    assert.deepEqual(results.map(r=>[r.result.label,r.binary.toString()]),[['first','first'],['second','second']]);
  } finally {a.close();b.close();await server.close();}
});
test('a wrong local secret cannot authenticate or dispatch',async()=>{
  const address=endpoint();let dispatched=0;
  const server=await listenCoordinator({...address,dispatch:async()=>{dispatched++;return {result:{}};}});
  const client=new CoordinatorConnection({...address,secret:'wrong'});
  try {await assert.rejects(client.request('identity',{}),/authenticat/i);assert.equal(dispatched,0);}
  finally{client.close();await server.close();}
});
test('owner disconnect aborts pending work and reports the same owner to the scheduler',async()=>{
  const address=endpoint();let started,aborted,disconnected;
  const began=new Promise(resolve=>started=resolve);
  const stopped=new Promise(resolve=>aborted=resolve);
  const gone=new Promise(resolve=>disconnected=resolve);
  const server=await listenCoordinator({...address,onDisconnect:owner=>disconnected(owner),dispatch:async(owner,method,args,signal)=>{
    started(owner);await new Promise((resolve,reject)=>signal.addEventListener('abort',()=>{aborted(owner);reject(signal.reason);},{once:true}));
    return {result:{}};
  }});
  const client=new CoordinatorConnection(address);
  try {
    const pending=client.request('slow',{}).catch(error=>error);
    const owner=await began;client.close();
    assert.equal(await stopped,owner);assert.equal(await gone,owner);
    assert.match((await pending).message,/closed|disconnect/i);
  } finally {client.close();await server.close();}
});
test('request cancellation aborts the server operation without leaking a later response',async()=>{
  const address=endpoint();let started,aborted;
  const began=new Promise(resolve=>started=resolve),stopped=new Promise(resolve=>aborted=resolve);
  const server=await listenCoordinator({...address,dispatch:async(owner,method,args,signal)=>{
    if(method==='ping')return {result:'alive'};
    started();await new Promise((resolve,reject)=>signal.addEventListener('abort',()=>{aborted();reject(signal.reason);},{once:true}));
    return {result:{}};
  }});
  const client=new CoordinatorConnection(address),controller=new AbortController();
  try {
    const pending=client.request('slow',{}, {signal:controller.signal});
    await began;controller.abort();await assert.rejects(pending,/cancel/i);await stopped;
    assert.equal((await client.request('ping',{})).result,'alive');
  } finally {client.close();await server.close();}
});
