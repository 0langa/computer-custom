/** Opt-in: kill only our own input worker after real mouse-down and verify release. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {HelperProcess,installedHelperPath} from '../build/server/helper-process.mjs';
const signed=process.argv.includes('--signed');
const inputMode=process.argv.includes('--block')?'block':'ignore';
const fixture=spawn('./tests/desktop-fixture/bin/Debug/net10.0-windows/computer-custom-fixture.exe',['1'],{windowsHide:false,stdio:['pipe','pipe','pipe']});
const lines=readline.createInterface({input:fixture.stdout}),queue=[],waiting=[];
lines.on('line',line=>{const value=JSON.parse(line);if(waiting.length)waiting.shift()(value);else queue.push(value);});
const next=()=>queue.length?Promise.resolve(queue.shift()):new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(new Error('Fixture response timed out')),3000);waiting.push(value=>{clearTimeout(timer);resolve(value);});
});
const helper=new HelperProcess(signed?{elevated:true,installedExecutablePath:installedHelperPath()}:{elevated:false,executablePath:path.resolve('dist/computer-custom/helper/computer-custom-helper.exe')});
try{
  const ready=await next(),window=ready.windows[0],target={handle:window.handle,pid:ready.pid,processStartTime:ready.processStartTime};
  const ping=(await helper.call('ping')).result;
  if(!signed){
    const activation=new HelperProcess({elevated:true,installedExecutablePath:installedHelperPath()});
    try{
      const focusLease=(await activation.call('begin_control',{inputMode:'ignore',durationMs:2000})).result;
      await activation.call('execute_step',{leaseId:focusLease.leaseId,target,op:'focus_window',args:{}});
      await activation.call('end_control',{leaseId:focusLease.leaseId});
    }finally{activation.stop();await activation.waitForStop();}
  }
  const lease=(await helper.call('begin_control',{inputMode,durationMs:2000})).result;
  await helper.call('execute_step',{leaseId:lease.leaseId,target,op:'focus_window',args:{}});
  fixture.stdin.write(`kill-on-down:${ping.pid}\n`);await next();
  let error;
  try{await helper.call('execute_step',{leaseId:lease.leaseId,target,op:'drag',args:{fromX:window.probe.x,fromY:window.probe.y,toX:window.probe.x+150,toY:window.probe.y,button:'left'}});}catch(failure){error=failure.code;}
  await delay(150);fixture.stdin.write('state\n');const state=(await next()).windows[0];
  let workerGone=false;try{process.kill(ping.pid,0);}catch(failure){workerGone=failure.code==='ESRCH';}
  const evidence={timestamp:new Date().toISOString(),signed,inputMode,error,workerGone,mouseDowns:state.mouseDowns,mouseUps:state.mouseUps,dragMoves:state.dragMoves,leftDown:state.leftDown};
  fs.mkdirSync('.cache/evidence',{recursive:true});fs.writeFileSync(`.cache/evidence/interrupted-drag-${inputMode}.json`,JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
  if(state.leftDown){
    // Clear only the synthetic button this diagnostic held, before reporting RED.
    const recovery=new HelperProcess({elevated:false,executablePath:path.resolve('dist/computer-custom/helper/computer-custom-helper.exe')});
    try{await recovery.call('click',{x:window.x+window.probe.x,y:window.y+window.probe.y,count:1,button:'left'});}finally{recovery.stop();}
  }
  assert.equal(workerGone,true);assert.equal(state.mouseDowns,1);assert.equal(state.mouseUps,1,'the fixture must receive button-up even after worker death');assert.ok(state.dragMoves>=2);assert.equal(state.leftDown,false);
}finally{helper.stop();await helper.waitForStop();fixture.kill();lines.close();}
