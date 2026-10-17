import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import readline from 'node:readline';
import {setTimeout as delay} from 'node:timers/promises';
import {DesktopWorkers} from '../build/server/desktop-workers.mjs';
import {Overlay} from '../build/server/overlay.mjs';
import {BatchCoordinator} from '../build/server/batch-coordinator.mjs';

const mode=process.argv[2]??'block';assert.ok(['block','ignore'].includes(mode));
const fixture=spawn('./tests/desktop-fixture/bin/Debug/net10.0-windows/computer-custom-fixture.exe',['1','--physical'],{windowsHide:false,stdio:['pipe','pipe','pipe']});
const lines=readline.createInterface({input:fixture.stdout}),messages=[],waiting=[];
lines.on('line',line=>{const value=JSON.parse(line);const next=waiting.shift();if(next)next(value);else messages.push(value);});
const next=(timeoutMs=2000)=>messages.length?Promise.resolve(messages.shift()):new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(new Error('Physical-input fixture did not respond')),timeoutMs);
  waiting.push(value=>{clearTimeout(timer);resolve(value);});
});
const state=async(command='state')=>{fixture.stdin.write(command+'\n');return (await next()).windows[0];};
const workers=new DesktopWorkers();let coordinator,leaseId;
const owner='physical-device-verification';
const overlay=new Overlay({executablePath:path.resolve('dist/computer-custom/helper/computer-custom-overlay.exe'),
  onPanic:()=>{workers.stop();coordinator?.disconnect(owner);},onCancel:id=>coordinator.cancel(owner,id),onSnooze:()=>coordinator.snooze()});
let evidence,during;
try{
  const ready=await next(),window=ready.windows[0],target={handle:window.handle,pid:ready.pid,processStartTime:ready.processStartTime};
  console.log(JSON.stringify({stage:'waiting-for-human-start',screen:1}));
  assert.equal((await next(120000)).kind,'physical-start');
  const status=(await workers.call('ping')).result;assert.equal(status.uiAccess,true,'signed helper required for a physical BlockInput test');
  coordinator=new BatchCoordinator({
    run:async(batch,signal,progress)=>{
      const abort=()=>workers.stop();signal.addEventListener('abort',abort,{once:true});
      try{
        const lease=(await workers.call('begin_control',{durationMs:10000,inputMode:mode})).result;leaseId=lease.leaseId;
        const step=(op,args)=>workers.call('execute_step',{leaseId,target,op,args},{timeoutMs:2000,signal});
        await step('click',window.input);await step('key',{keys:['ctrl','a']});await step('type_text',{text:'AGENT_BASELINE'});
        await delay(100);
        const before={window:await state(),cursor:(await workers.call('cursor_position')).result};
        if(before.window.text!=='AGENT_BASELINE'){
          console.log(JSON.stringify({stage:'baseline-failed',before,foreground:(await workers.call('foreground_window')).result,
            target:(await workers.call('resolve_target',{target})).result,requestedInput:window.input}));
          throw new Error('Agent baseline did not reach the field; physical test was not started.');
        }
        await state(`phase:${mode==='block'?'BLOCKED':'INPUT ENABLED'} - 6.5 seconds|MOVE THE MOUSE AND PRESS X NOW|No clicking needed.`);
        console.log(JSON.stringify({stage:'physical-attempt-now',inputMode:mode,seconds:6.5,inputBlocked:lease.inputBlocked}));
        const dispatchMs=[];
        if(mode==='ignore'){
          const until=performance.now()+6500;
          while(performance.now()<until){
            const at=performance.now();await step('key',{keys:['right']});dispatchMs.push(performance.now()-at);
            await delay(200,undefined,{signal});
          }
        }else await delay(6500,undefined,{signal});
        signal.throwIfAborted();
        during={window:await state(),cursor:(await workers.call('cursor_position')).result};
        await workers.call('end_control',{leaseId},{timeoutMs:500});leaseId=undefined;progress(1);
        await state('title:RELEASED - move mouse and press X again');
        await state('phase:RELEASED - 20 seconds|MOVE THE MOUSE AND PRESS X AGAIN|Your X characters should appear in the field.');
        console.log(JSON.stringify({stage:'released-repeat-now',seconds:20}));
        const cursorEqual=(a,b)=>a.x===b.x&&a.y===b.y;
        evidence={timestamp:new Date().toISOString(),sourceId:fs.readFileSync('dist/computer-custom/helper/build-id.txt','utf8').trim(),inputMode:mode,
          inputBlocked:lease.inputBlocked,duringTextUnchanged:during.window.text===before.window.text,
          duringCursorUnchanged:cursorEqual(before.cursor,during.cursor),
          physicalAttemptConfirmed:false,beforeTextLength:before.window.text.length,duringTextLength:during.window.text.length,
          ignoredActivityDispatches:dispatchMs.length,dispatchP95Ms:dispatchMs.length?dispatchMs.toSorted((a,b)=>a-b)[Math.ceil(dispatchMs.length*.95)-1]:null};
      }finally{signal.removeEventListener('abort',abort);if(leaseId){try{await workers.call('end_control',{leaseId},{timeoutMs:500});}catch{workers.stop();}leaseId=undefined;}}
    },
    showNotice:batch=>overlay.showNotice({batchId:batch.id,title:`Physical ${mode} test: use mouse/X when notice disappears`,actions:1,
      ...batch.settings,x:window.x,y:window.y}).then(()=>{}),
    hideNotice:batch=>overlay.hideNotice(batch.id).then(()=>{}),
    onChange:batch=>{if(['countdown','snoozed','failed','cancelled'].includes(batch.state))console.log(JSON.stringify({state:batch.state,readyAt:batch.readyAt,resumeAt:batch.resumeAt,error:batch.error}));},
  });
  let batch=coordinator.prepare(owner,{actions:[{op:'physical_probe',target,args:{}}],inputMode:mode,flush:true});
  while(!['succeeded','failed','cancelled'].includes(batch.state)){
    if(batch.state==='snoozed')throw new Error(`Physical test snoozed until ${batch.resumeAt}`);
    batch=await coordinator.wait(owner,batch.id,batch.revision);
  }
  assert.equal(batch.state,'succeeded',JSON.stringify(batch.error));
  await delay(20000);
  const after={window:await state(),cursor:(await workers.call('cursor_position')).result};
  Object.assign(evidence,{afterTextChanged:after.window.text!==during.window.text,
    afterCursorChanged:after.cursor.x!==during.cursor.x||after.cursor.y!==during.cursor.y,afterTextLength:after.window.text.length});
  fs.mkdirSync('.cache/evidence',{recursive:true});fs.writeFileSync(`.cache/evidence/physical-${mode}.json`,JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
  if(mode==='block'){assert.equal(evidence.duringTextUnchanged,true);assert.equal(evidence.duringCursorUnchanged,true);}
  else {assert.ok(evidence.ignoredActivityDispatches>=20);assert.ok(evidence.dispatchP95Ms<250);}
}finally{coordinator?.disconnect(owner);workers.stop();overlay.stop();fixture.kill();lines.close();}
