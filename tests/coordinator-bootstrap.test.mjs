import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { test } from 'node:test';
import { mock } from 'node:test';
import { HelperProcess } from '../build/server/helper-process.mjs';
import { CoordinatorClient } from '../build/server/coordinator-client.mjs';

test('independent Node clients race startup but reach one coordinator for this Windows session',async()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'cc-service-'));
  const moduleUrl=new URL('../build/server/coordinator-client.mjs',import.meta.url).href;
  const script=`import {CoordinatorClient} from ${JSON.stringify(moduleUrl)};const c=new CoordinatorClient();try{console.log(JSON.stringify((await c.request('hello',{})).result));await new Promise(r=>setTimeout(r,1000));}finally{c.stop();}`;
  const env={...process.env,COMPUTER_CUSTOM_DATA:directory,COMPUTER_CUSTOM_COORDINATOR_IDLE_MS:'1000'};
  const run=()=>new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,['--input-type=module','-e',script],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});let out='',err='';
    child.stdout.on('data',c=>out+=c);child.stderr.on('data',c=>err+=c);child.on('error',reject);
    child.on('exit',code=>code===0?resolve(JSON.parse(out)):reject(new Error(err)));
  });
  try{const [a,b]=await Promise.all([run(),run()]);assert.equal(a.pid,b.pid);assert.equal(a.protocol,1);assert.equal(a.settings.countdownMs,5000);}
  finally{await new Promise(r=>setTimeout(r,1400));fs.rmSync(directory,{recursive:true,force:true});}
});

test('cancelling initial discovery does not start a coordinator afterward',async()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'cc-cancel-start-'));
  const previous=process.env.COMPUTER_CUSTOM_DATA;process.env.COMPUTER_CUSTOM_DATA=directory;
  const client=new CoordinatorClient(),controller=new AbortController();
  try{
    const started=performance.now(),pending=client.request('hello',{},{signal:controller.signal});
    controller.abort();await assert.rejects(pending,/cancel|abort/i);
    assert.ok(performance.now()-started<250,'cancellation must not wait for startup');
    await new Promise(r=>setTimeout(r,300));
    assert.ok(!fs.readdirSync(directory).some(name=>name.endsWith('.log')),'cancelled startup launched a detached service');
  }finally{client.stop();if(previous===undefined)delete process.env.COMPUTER_CUSTOM_DATA;else process.env.COMPUTER_CUSTOM_DATA=previous;await new Promise(r=>setTimeout(r,100));fs.rmSync(directory,{recursive:true,force:true});}
});

test('one transient read-only discovery failure is recovered without retrying a desktop action',async()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'cc-discovery-retry-'));
  const previous=process.env.COMPUTER_CUSTOM_DATA,previousIdle=process.env.COMPUTER_CUSTOM_COORDINATOR_IDLE_MS;
  process.env.COMPUTER_CUSTOM_DATA=directory;process.env.COMPUTER_CUSTOM_COORDINATOR_IDLE_MS='1000';
  const original=HelperProcess.prototype.call;let calls=0;
  const stub=mock.method(HelperProcess.prototype,'call',function(op,...args){
    calls++;if(calls===1)return Promise.reject(Object.assign(new Error('cold startup timeout'),{code:'HELPER_UNAVAILABLE'}));
    return original.call(this,op,...args);
  });
  const client=new CoordinatorClient();
  try{assert.equal((await client.request('hello',{})).result.protocol,1);assert.equal(calls,2);}
  finally{client.stop();stub.mock.restore();if(previous===undefined)delete process.env.COMPUTER_CUSTOM_DATA;else process.env.COMPUTER_CUSTOM_DATA=previous;
    if(previousIdle===undefined)delete process.env.COMPUTER_CUSTOM_COORDINATOR_IDLE_MS;else process.env.COMPUTER_CUSTOM_COORDINATOR_IDLE_MS=previousIdle;
    await new Promise(r=>setTimeout(r,1400));fs.rmSync(directory,{recursive:true,force:true});}
});

test('a later read recovers after the shared coordinator dies without replaying the failed mutation',async()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'cc-restart-'));
  const previous=process.env.COMPUTER_CUSTOM_DATA,previousIdle=process.env.COMPUTER_CUSTOM_COORDINATOR_IDLE_MS;
  process.env.COMPUTER_CUSTOM_DATA=directory;process.env.COMPUTER_CUSTOM_COORDINATOR_IDLE_MS='1000';
  const client=new CoordinatorClient();
  try{
    const first=(await client.request('hello',{})).result;
    process.kill(first.pid);await new Promise(r=>setTimeout(r,200));
    const second=(await client.request('hello',{})).result;
    assert.notEqual(second.pid,first.pid);
  }finally{client.stop();if(previous===undefined)delete process.env.COMPUTER_CUSTOM_DATA;else process.env.COMPUTER_CUSTOM_DATA=previous;
    if(previousIdle===undefined)delete process.env.COMPUTER_CUSTOM_COORDINATOR_IDLE_MS;else process.env.COMPUTER_CUSTOM_COORDINATOR_IDLE_MS=previousIdle;
    await new Promise(r=>setTimeout(r,1400));fs.rmSync(directory,{recursive:true,force:true});}
});
