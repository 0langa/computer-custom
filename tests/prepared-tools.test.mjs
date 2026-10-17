import assert from 'node:assert/strict';
import { test } from 'node:test';
import { registerTools } from '../build/server/tools.mjs';
import policy from '../overlay/config/default-policy.json' with {type:'json'};
import {DesktopSession} from '../build/server/desktop-session.mjs';
const target={handle:11,pid:22,processStartTime:'test'};
function context(){
  const registrations=new Map(),calls=[];
  const helper={call:async(op,args)=>{calls.push([op,args]);return {result:{queued:true}};},stop(){},
    request:async(method,args)=>{calls.push([method,args]);return {result:{id:'batch',state:'prepared'}};},
    flush:async()=>{calls.push(['flush']);return {result:{state:'succeeded'}};},cancelPending:async()=>{}};
  const invoke=registerTools({mcp:{registerTool:(name,config,handler)=>registrations.set(name,{config,handler})},
    helper,desktop:helper,policy:{...policy,protectedRoots:[],hardBlock:{appPatterns:[],textPatterns:[]},confirm:{...policy.confirm,riskyMethods:[],alwaysConfirmMethods:[],appPatterns:[],textPatterns:[]}},
    audit:{append(){}},session:{halted:false}});
  return {invoke,calls,registrations};
}
test('MCP exposes explicit batch preparation and rejects malformed actions before dispatch',async()=>{
  const {invoke,calls,registrations}=context();
  for(const name of ['observe','prepare_batch','batch_status','wait_batch','cancel_batch','flush_batch','desktop_settings'])assert.ok(registrations.has(name),name);
  const response=await invoke('prepare_batch',{actions:[{op:'click',target,args:{x:5,y:5}}]});
  assert.ok(!response.isError);assert.equal(calls.at(-1)[0],'prepare');
  const before=calls.length;assert.equal((await invoke('prepare_batch',{actions:[{op:'click',target,args:{x:'bad',y:5}}]})).isError,true);assert.equal(calls.length,before);
});
test('default input dispatch does not perform a foreground read that flushes each previous action',async()=>{
  const {invoke,calls}=context();
  await invoke('click',{x:100,y:200});await invoke('key',{keys:['enter']});
  assert.deepEqual(calls.map(c=>c[0]),['click','key']);
});

function policySession(blocked){
  const calls=[],actions=[],selected={...target,process:'blockedapp',title:'Selected window',x:100,y:200,width:400,height:300};let revision=0;
  const helper=new DesktopSession({stop(){},request:async(method,args)=>{
    calls.push([method,args]);
    if(method==='observe')return {result:{target:args.target}};
    if(method==='native'){
      if(args.op==='foreground_window')return {result:{...selected,handle:99,process:'safeapp'}};
      if(args.op==='list_windows')return {result:[selected]};
      if(args.op==='resolve_target')return {result:selected};
    }
    if(method==='prepare')actions.push(...args.actions);
    return {result:{id:'batch',state:method==='wait_batch'?'succeeded':'queued',revision:++revision}};
  }});
  const invoke=registerTools({mcp:{registerTool(){}},helper,desktop:helper,policy:{...policy,
    hardBlock:{appPatterns:[blocked],textPatterns:[]},confirm:{...policy.confirm,appPatterns:[],textPatterns:[],riskyMethods:[],alwaysConfirmMethods:[]}},
    audit:{append(){}},session:{halted:false}});
  return {invoke,calls,actions};
}
test('explicit app policy classifies the bound batch target instead of foreground',async()=>{
  const {invoke,calls}=policySession('blockedapp');
  const result=await invoke('prepare_batch',{actions:[{op:'key',target,args:{keys:['enter']}}]});
  assert.equal(result.isError,true);assert.ok(calls.some(c=>c[0]==='native'&&c[1].op==='resolve_target'));
  assert.ok(calls.every(c=>c[0]!=='prepare'));
});
test('legacy app policy cannot replace an observed target with the foreground window',async()=>{
  const {invoke,calls,actions}=policySession('unrelatedapp');
  await invoke('observe',{target,mode:'tree'});const result=await invoke('type_text',{text:'hello'});
  assert.ok(!result.isError,JSON.stringify(result));assert.deepEqual(actions[0].target,target);
  assert.ok(calls.every(c=>c[0]!=='native'||c[1].op!=='foreground_window'));
});
test('legacy selected target is blocked by its actual application before input is queued',async()=>{
  const {invoke,actions}=policySession('blockedapp');
  await invoke('observe',{target,mode:'tree'});
  assert.equal((await invoke('key',{keys:['enter']})).isError,true);assert.equal(actions.length,0);
});
