import assert from 'node:assert/strict';
import { test } from 'node:test';
import { registerTools } from '../build/server/tools.mjs';
import policy from '../overlay/config/default-policy.json' with {type:'json'};
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
