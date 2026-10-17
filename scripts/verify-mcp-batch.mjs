import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import {spawn} from 'node:child_process';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
const screens=process.argv[2]??'1,0';
const focusRepeats=process.argv.includes('--focus-stress')?20:0;
const fixture=spawn('./tests/desktop-fixture/bin/Debug/net10.0-windows/computer-custom-fixture.exe',[screens],{windowsHide:false,stdio:['pipe','pipe','pipe']});
const lines=readline.createInterface({input:fixture.stdout}),messages=[],waiters=[];
lines.on('line',line=>{const value=JSON.parse(line);const waiter=waiters.shift();if(waiter)waiter.resolve(value);else messages.push(value);});
const next=()=>messages.length?Promise.resolve(messages.shift()):new Promise((resolve,reject)=>{
  const item={resolve:value=>{clearTimeout(timer);resolve(value);},reject};
  const timer=setTimeout(()=>{const i=waiters.indexOf(item);if(i>=0)waiters.splice(i,1);reject(new Error('Fixture response timed out'));},3000);waiters.push(item);
});
fixture.on('exit',()=>{for(const waiter of waiters.splice(0))waiter.reject(new Error('Fixture closed'));});
const clients=[];
async function connect(){
  const client=new Client({name:'prepared-desktop-verification',version:'1'});
  const root=path.resolve('dist/computer-custom');
  const transport=new StdioClientTransport({command:process.execPath,args:[path.join(root,'server/index.mjs')],
    env:{...process.env,COMPUTER_CUSTOM_POLICY:path.join(root,'config/default-policy.json'),COMPUTER_CUSTOM_HELPER:path.join(root,'helper/computer-custom-helper.exe')},stderr:'pipe'});
  await client.connect(transport);clients.push(client);return client;
}
async function call(client,name,args={}){
  const result=await client.callTool({name,arguments:args},undefined,{timeout:90000});
  if(result.isError)throw new Error(result.content.filter(c=>c.type==='text').map(c=>c.text).join('\n'));
  return JSON.parse(result.content.find(c=>c.type==='text').text);
}
const walk=node=>[node,...node.children.flatMap(walk)];
try{
  const ready=await next(),targets=ready.windows.map(w=>({...w,pid:ready.pid,processStartTime:ready.processStartTime}));
  const [a,b]=await Promise.all([connect(),connect()]);
  const status=await call(a,'status');console.log(JSON.stringify({stage:'status',uiAccess:status.uiAccess,power:status.power,sourceNotice:status.start?.notice}));
  const views=[];for(const target of targets)views.push(walk((await call(a,'ui_tree',{handle:target.handle,interactiveOnly:false})).root));
  const actions=[];
  for(let n=0;n<10;n++)for(const target of targets)actions.push({op:'click',target,args:target.a},{op:'click',target,args:target.b});
  for(const [i,target] of targets.entries()){
    const text=`screen ${target.screen} — ✓ Ω 😀`,edit=views[i].find(e=>e.automationId==='text-input'),button=views[i].find(e=>e.automationId==='button-a');
    assert.ok(edit&&button);
    actions.push({op:'click',target,args:target.input,expect:{elementId:edit.elementId,property:'focused',equals:true}},{op:'key',target,args:{keys:['ctrl','a']}},
      {op:'type_text',target,args:{text},expect:{elementId:edit.elementId,property:'value',equals:text}},{op:'set_element_value',target,args:{elementId:edit.elementId,value:`UIA: ${text}`}},
      {op:'invoke_element',target,args:{elementId:button.elementId},expect:{elementId:button.elementId,property:'name',equals:'A 11'}});
  }
  for(let n=0;n<focusRepeats;n++)for(const [i,target] of targets.entries()){
    const button=views[i].find(e=>e.automationId==='button-a');
    actions.push({op:'invoke_element',target,args:{elementId:button.elementId},expect:{elementId:button.elementId,property:'name',equals:`A ${12+n}`}});
  }
  let first=await call(a,'prepare_batch',{actions,flush:true,title:'Two-screen MCP verification'});
  let second=await call(b,'prepare_batch',{actions:[{op:'click',target:targets[0],args:targets[0].a},{op:'click',target:targets[0],args:targets[0].b}],flush:true,title:'Second MCP client verification'});
  for(const [client,initial] of [[a,first],[b,second]]){
    let batch=initial,lastState='';
    while(!['succeeded','failed','cancelled'].includes(batch.state)){
      if(batch.state!==lastState){console.log(JSON.stringify({batch:batch.id,state:batch.state,readyAt:batch.readyAt,resumeAt:batch.resumeAt}));lastState=batch.state;}
      if(batch.state==='snoozed')throw new Error(`Verification snoozed until ${batch.resumeAt}`);
      batch=await call(client,'wait_batch',{id:batch.id,afterRevision:batch.revision});
    }
    if(batch.state!=='succeeded'){
      fixture.stdin.write('state\n');const failure=await next();
      fs.mkdirSync('.cache/evidence',{recursive:true});fs.writeFileSync('.cache/evidence/mcp-failure.json',JSON.stringify({batch,fixture:failure},null,2));
    }
    assert.equal(batch.state,'succeeded',JSON.stringify(batch));
    if(client===a)first=batch;else second=batch;
  }
  assert.ok(Date.parse(second.startedAt)>=Date.parse(first.finishedAt),'MCP owners must not overlap control');
  await new Promise(resolve=>setTimeout(resolve,150));fixture.stdin.write('state\n');const observed=await next();
  fs.mkdirSync('.cache/evidence',{recursive:true});fs.writeFileSync('.cache/evidence/mcp-observed.json',JSON.stringify(observed,null,2));
  for(const [i,w] of observed.windows.entries()){
    assert.equal(w.aCount,11+focusRepeats+(i===0?1:0));assert.equal(w.bCount,10+(i===0?1:0));
    assert.deepEqual(w.events.map(e=>e.control),[...Array.from({length:20},(_,i)=>i%2?'B':'A'),'A',...Array(focusRepeats).fill('A'),...(i===0?['A','B']:[])]);
    assert.ok(w.textValues.includes(`screen ${w.screen} — ✓ Ω 😀`));assert.equal(w.text,`UIA: screen ${w.screen} — ✓ Ω 😀`);
  }
  const evidence={sourceId:fs.readFileSync('dist/computer-custom/helper/build-id.txt','utf8').trim(),timestamp:new Date().toISOString(),screens,
    clients:2,actions:first.total+second.total,accurate:true,serialized:true,firstExecutionMs:Date.parse(first.finishedAt)-Date.parse(first.startedAt),
    secondExecutionMs:Date.parse(second.finishedAt)-Date.parse(second.startedAt),countdownMs:first.settings.countdownMs,inputInterferenceTested:false};
  fs.mkdirSync('.cache/evidence',{recursive:true});fs.writeFileSync('.cache/evidence/mcp-batches.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
}finally{for(const client of clients)await client.close();fixture.kill();lines.close();}
