import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import readline from 'node:readline';
import path from 'node:path';
import fs from 'node:fs';
import { DesktopWorkers } from '../build/server/desktop-workers.mjs';
import { Overlay } from '../build/server/overlay.mjs';
import { BatchCoordinator } from '../build/server/batch-coordinator.mjs';
import { runPreparedBatch } from '../build/server/batch-runner.mjs';
const screens=process.argv[2]??'1';
execFileSync('dotnet',['build','tests/desktop-fixture','--nologo','-v:q'],{windowsHide:true,stdio:'pipe'});
const fixture=spawn('./tests/desktop-fixture/bin/Debug/net10.0-windows/computer-custom-fixture.exe',[screens],
  {windowsHide:false,stdio:['pipe','pipe','pipe']});
const lines=readline.createInterface({input:fixture.stdout}),waiting=[],messages=[];
lines.on('line',line=>{const value=JSON.parse(line);const waiter=waiting.shift();if(waiter)waiter(value);else messages.push(value);});
const next=()=>messages.length?Promise.resolve(messages.shift()):new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(new Error('Fixture did not respond')),3000);
  waiting.push(value=>{clearTimeout(timer);resolve(value);});
});
const workers=new DesktopWorkers();
const owner='live-fixture';
let coordinator;
const overlay=new Overlay({executablePath:path.resolve('dist/computer-custom/helper/computer-custom-overlay.exe'),
  onSnooze:()=>coordinator.snooze(),onCancel:id=>coordinator.cancel(owner,id),
  onPanic:()=>coordinator.disconnect(owner)});
const walk=node=>[node,...node.children.flatMap(walk)];
try {
  const ready=await next();
  const targets=ready.windows.map(w=>({...w,pid:ready.pid,processStartTime:ready.processStartTime}));
  const info=(await workers.call('ping')).result;
  console.log(JSON.stringify({screens,power:info.power,uiAccess:info.uiAccess}));
  const views=[];
  for(const target of targets)views.push(walk((await workers.call('ui_tree',{handle:target.handle,interactiveOnly:false})).result.root));
  const actions=[];
  for(let i=0;i<10;i++)for(const target of targets){
    actions.push({op:'click',target,args:target.a},{op:'click',target,args:target.b});
  }
  for(const [index,target] of targets.entries()){
    const edit=views[index].find(e=>e.automationId==='text-input');
    const a=views[index].find(e=>e.automationId==='button-a');
    assert.ok(edit&&a,'fixture accessibility controls');
    const typed=`screen ${target.screen} — ✓ Ω 😀`;
    actions.push({op:'click',target,args:target.input},{op:'key',target,args:{keys:['ctrl','a']}},
      {op:'type_text',target,args:{text:typed}},
      {op:'set_element_value',target,args:{elementId:edit.elementId,value:`UIA: ${typed}`}},
      {op:'invoke_element',target,args:{elementId:a.elementId}});
  }
  coordinator=new BatchCoordinator({run:(batch,signal,progress)=>runPreparedBatch(workers,batch,signal,progress),
    showNotice:batch=>overlay.showNotice({batchId:batch.id,title:'Prepared input verification',actions:batch.actions.length,
      ...batch.settings,x:targets[0].x,y:targets[0].y}).then(()=>{}),
    hideNotice:batch=>overlay.hideNotice(batch.id).then(()=>{}),
    onChange:batch=>{if(['countdown','snoozed','running','succeeded','failed','cancelled'].includes(batch.state))
      console.log(JSON.stringify({state:batch.state,completed:batch.completed,readyAt:batch.readyAt,resumeAt:batch.resumeAt,error:batch.error}));},
  });
  let batch=coordinator.prepare(owner,{actions,flush:true});
  while(!['succeeded','failed','cancelled'].includes(batch.state))batch=await coordinator.wait(owner,batch.id,batch.revision);
  assert.equal(batch.state,'succeeded',JSON.stringify(batch.error));
  await new Promise(resolve=>setTimeout(resolve,200));fixture.stdin.write('state\n');
  const result=await next();
  for(const w of result.windows){
    assert.equal(w.aCount,11);assert.equal(w.bCount,10);
    assert.deepEqual(w.events.map(e=>e.control),[...Array.from({length:20},(_,i)=>i%2?'B':'A'),'A']);
    const typed=`screen ${w.screen} — ✓ Ω 😀`;
    assert.ok(w.textValues.includes(typed),'Unicode typing reached the control before the following UIA operation');
    assert.equal(w.text,`UIA: ${typed}`);
  }
  const evidence={sourceId:fs.readFileSync('dist/computer-custom/helper/build-id.txt','utf8').trim(),timestamp:new Date().toISOString(),
    screens,actions:actions.length,accurate:true,executionMs:Date.parse(batch.finishedAt)-Date.parse(batch.startedAt),
    countdownMs:batch.settings.countdownMs,inputInterferenceTested:false};
  fs.mkdirSync('.cache/evidence',{recursive:true});
  fs.writeFileSync(`.cache/evidence/prepared-${screens.replaceAll(',','-')}.json`,JSON.stringify(evidence,null,2));
  console.log(JSON.stringify(evidence));
} finally {coordinator?.disconnect(owner);workers.stop();overlay.stop();fixture.kill();lines.close();}
