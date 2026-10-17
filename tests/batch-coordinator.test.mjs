import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BatchCoordinator } from '../build/server/batch-coordinator.mjs';

const flush=()=>new Promise(resolve=>setImmediate(resolve));
class Clock {
  now=()=>this.time;
  time=1000000;
  timers=new Map();
  next=0;
  setTimeout=(fn,ms)=>{const id=++this.next;this.timers.set(id,{at:this.time+ms,fn});return id;};
  clearTimeout=(id)=>{this.timers.delete(id);};
  async advance(ms){
    const end=this.time+ms;
    while(true){
      const first=[...this.timers.entries()].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];
      if(!first)break;
      this.time=first[1].at;this.timers.delete(first[0]);first[1].fn();await flush();
    }
    this.time=end;await flush();
  }
}
const actions=(count=1)=>Array.from({length:count},()=>({op:'click',target:{handle:1,pid:2,processStartTime:'3'},args:{x:10,y:10}}));
function setup(run=async()=>{}) {
  const clock=new Clock(), notices=[], events=[];
  const coordinator=new BatchCoordinator({clock,run,showNotice:async batch=>{notices.push(batch.id);},hideNotice:async()=>{},onChange:b=>events.push(b)});
  return {clock,coordinator,notices,events};
}
test('a failed batch cancels later work from its owner while other owners continue',async()=>{
  const executed=[];
  const {clock,coordinator}=setup(async batch=>{executed.push(batch.owner);if(batch.owner==='a')throw new Error('unexpected modal');});
  const first=coordinator.prepare('a',{actions:actions(),flush:true});
  const later=coordinator.prepare('a',{actions:actions(),flush:true});
  const other=coordinator.prepare('b',{actions:actions(),flush:true});
  await flush();await clock.advance(45000);
  assert.equal(coordinator.status('a',first.id).state,'failed');
  assert.equal(coordinator.status('a',later.id).state,'cancelled');
  assert.equal(coordinator.status('b',other.id).state,'succeeded');assert.deepEqual(executed,['a','b']);
});

test('five prepared actions trigger one countdown and execute without acknowledgment',async()=>{
  const calls=[];
  const {clock,coordinator,notices}=setup(async batch=>calls.push(batch.actions.length));
  const initial=coordinator.prepare('a',{actions:actions(4)});
  await flush();assert.equal(initial.state,'prepared');assert.equal(notices.length,0);
  const queued=coordinator.prepare('a',{id:initial.id,actions:actions()});
  await flush();assert.equal(notices.length,1);
  await clock.advance(4999);assert.equal(calls.length,0);
  await clock.advance(1);assert.deepEqual(calls,[5]);
  assert.equal(coordinator.status('a',queued.id).state,'succeeded');
});
test('a partial flush is cancellable during its countdown',async()=>{
  const {clock,coordinator}=setup(()=>assert.fail('cancelled batch must not run'));
  const batch=coordinator.prepare('a',{actions:actions(2),flush:true});
  await flush();assert.equal(coordinator.status('a',batch.id).state,'countdown');
  coordinator.cancel('a',batch.id);
  await clock.advance(30000);assert.equal(coordinator.status('a',batch.id).state,'cancelled');
  assert.throws(()=>coordinator.status('b',batch.id),/owner/i);
});
test('snooze defers all sessions and returns a shared resume time',async()=>{
  const calls=[];
  const {clock,coordinator}=setup(async batch=>calls.push(batch.owner));
  const a=coordinator.prepare('a',{actions:actions(2),flush:true});
  const b=coordinator.prepare('b',{actions:actions(2),flush:true});
  await flush();
  const resumeAt=coordinator.snooze();
  assert.equal(coordinator.status('a',a.id).resumeAt,resumeAt);
  assert.equal(coordinator.status('b',b.id).resumeAt,resumeAt);
  await clock.advance(300000-1);assert.equal(calls.length,0);
  await clock.advance(1);assert.equal(coordinator.status('a',a.id).state,'countdown');
  await clock.advance(5000);assert.deepEqual(calls,['a']);
  await clock.advance(5000);assert.deepEqual(calls,['a','b']);
});
test('competing sessions cannot enter input together, including during disconnect cleanup',async()=>{
  let release, started=[];
  const {clock,coordinator}=setup(async(batch,signal)=>{
    started.push(batch.owner);
    if(batch.owner==='a') await new Promise((resolve,reject)=>{
      signal.addEventListener('abort',()=>{release=()=>{reject(signal.reason);};},{once:true});
    });
  });
  const a=coordinator.prepare('a',{actions:actions(),flush:true});
  const b=coordinator.prepare('b',{actions:actions(),flush:true});
  await flush();await clock.advance(0);
  coordinator.disconnect('a');await flush();
  assert.equal(coordinator.status('a',a.id).state,'cancelling');
  await clock.advance(10000);assert.deepEqual(started,['a']);
  release();await flush();
  assert.equal(coordinator.status('a',a.id).state,'cancelled');
  await clock.advance(15000);assert.deepEqual(started,['a','b']);
  assert.equal(coordinator.status('b',b.id).state,'succeeded');
});
test('the control deadline aborts a slow batch and retains completed progress',async()=>{
  const {clock,coordinator}=setup(async(batch,signal,progress)=>{
    progress(1);
    await new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));
  });
  const batch=coordinator.prepare('a',{actions:actions(2),flush:true});
  await flush();await clock.advance(15000);await clock.advance(10000);
  const status=coordinator.status('a',batch.id);
  assert.equal(status.state,'failed');assert.equal(status.completed,1);
  assert.equal(status.error.code,'CONTROL_EXPIRED');
});
test('cancelling while notice creation is pending cannot start a delayed takeover',async()=>{
  const clock=new Clock();let shown;
  const coordinator=new BatchCoordinator({clock,run:()=>assert.fail('late notice'),showNotice:()=>new Promise(resolve=>shown=resolve),hideNotice:async()=>{}});
  const batch=coordinator.prepare('a',{actions:actions(2),flush:true});
  await flush();coordinator.cancel('a',batch.id);shown();await flush();
  await clock.advance(15000);assert.equal(coordinator.status('a',batch.id).state,'cancelled');
});

test('a single flushed action executes immediately without creating or hiding a notice',async()=>{
  const clock=new Clock();let runs=0;
  const coordinator=new BatchCoordinator({clock,run:async()=>{runs++;},
    showNotice:()=>assert.fail('single action warning'),hideNotice:()=>assert.fail('no notice to hide')});
  const batch=coordinator.prepare('a',{actions:actions(),flush:true});
  await flush();assert.equal(runs,1);assert.equal(coordinator.status('a',batch.id).state,'succeeded');
  assert.equal(clock.time,1000000);
});
test('an explicitly deferred script stays together until its dependency flush',async()=>{
  const {coordinator,notices}=setup();
  const initial=coordinator.prepare('a',{actions:actions(12),flush:false});
  await flush();assert.equal(coordinator.status('a',initial.id).state,'prepared');assert.equal(notices.length,0);
  coordinator.prepare('a',{id:initial.id,actions:[],flush:true});await flush();assert.equal(notices.length,1);
});
