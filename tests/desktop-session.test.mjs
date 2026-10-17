import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DesktopSession } from '../build/server/desktop-session.mjs';

const target={handle:11,pid:22,processStartTime:'test'};
function fake(){
  const calls=[];const actions=[];let revision=0,state='prepared';
  const client={stop(){},request:async(method,args)=>{
    calls.push([method,args]);
    if(method==='observe')return {result:{target:args.target}};
    if(method==='native'){
      if(args.op==='list_windows')return {result:[{...target,x:100,y:200,width:300,height:200}]};
      if(args.op==='resolve_element')return {result:{target}};
      if(args.op==='ui_tree')return {result:{target,root:{}}};
      return {result:{...target,x:100,y:200,width:300,height:200}};
    }
    if(method==='prepare'){actions.push(...args.actions);state=args.flush||(args.flush!==false&&actions.length>=5)?'queued':'prepared';}
    if(method==='wait_batch')state='succeeded';
    if(method==='cancel_batch')state='cancelled';
    return {result:{id:'batch',state,revision:++revision,total:actions.length,completed:state==='succeeded'?actions.length:0}};
  }};
  return {session:new DesktopSession(client),calls,actions};
}
test('legacy actions batch in order and observation flushes a partial batch before reading',async()=>{
  const {session,calls,actions}=fake();
  await session.call('focus_window',{handle:11});
  await session.call('click',{x:130,y:250});
  await session.call('type_text',{text:'hello'});
  assert.equal(calls.filter(c=>c[0]==='wait_batch').length,0);
  await session.call('ui_tree',{handle:11});
  assert.deepEqual(actions.map(a=>a.op),['focus_window','click','type_text']);
  assert.deepEqual(actions[1],{op:'click',target,args:{x:30,y:50}});
  const read=calls.findIndex(c=>c[0]==='native'&&c[1].op==='ui_tree');
  const wait=calls.findIndex(c=>c[0]==='wait_batch');assert.ok(read>wait);
});
test('concurrent legacy calls append to one prepared batch and never send raw input',async()=>{
  const {session,calls,actions}=fake();
  await Promise.all([session.call('click',{x:130,y:250}),session.call('key',{keys:['enter']})]);
  assert.equal(actions.length,2);assert.equal(calls.filter(c=>c[0]==='prepare')[1][1].id,'batch');
  assert.ok(calls.every(c=>c[0]!=='native'||!['click','key'].includes(c[1].op)));
});
test('UIA actions use the owning snapshot target and reject unknown input operations',async()=>{
  const {session,actions}=fake();await session.call('invoke_element',{elementId:'view:button'});
  assert.deepEqual(actions[0].target,target);
  await assert.rejects(session.call('begin_control',{}),/prepared|unsupported/i);
});

test('an explicit partial batch is flushed before the next observation',async()=>{
  const {session,calls}=fake();
  await session.request('prepare',{actions:[{op:'click',target,args:{x:10,y:10}}]});
  await session.request('observe',{target});
  assert.ok(calls.some(([method,args])=>method==='prepare'&&args.id==='batch'&&args.flush));
  assert.ok(calls.findIndex(c=>c[0]==='wait_batch')<calls.findIndex(c=>c[0]==='observe'));
});
test('typing after observing a selected window stays bound to that window',async()=>{
  const {session,actions}=fake();const selected={handle:99,pid:101,processStartTime:'selected'};
  await session.request('observe',{target:selected});await session.call('type_text',{text:'test'});
  assert.deepEqual(actions[0].target,selected);
});
test('a saved flow collects known steps beyond the threshold until an observation dependency',async()=>{
  const {session,calls,actions}=fake();
  await session.withPreparedFlow(async()=>{
    for(let n=0;n<12;n++)await session.call('key',{target,keys:['tab']});
    assert.equal(calls.filter(c=>c[0]==='wait_batch').length,0);
    assert.ok(calls.filter(c=>c[0]==='prepare').every(c=>c[1].flush===false));
    await session.call('ui_tree',{handle:11});
  });
  assert.equal(actions.length,12);assert.equal(calls.filter(c=>c[0]==='wait_batch').length,1);
});
