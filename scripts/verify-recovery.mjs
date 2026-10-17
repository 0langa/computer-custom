/** Opt-in real MCP/BlockInput recovery on the HUAWEI fixture. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {openDesktop} from './interactive-desktop.mjs';
import {CoordinatorClient} from '../build/server/coordinator-client.mjs';
import {installedHelperPath} from '../build/server/helper-process.mjs';
const cache=path.resolve('.cache');fs.mkdirSync(cache,{recursive:true});
const data=fs.mkdtempSync(path.join(cache,'recovery-'));
process.env.COMPUTER_CUSTOM_DATA=data;process.env.COMPUTER_CUSTOM_COORDINATOR_IDLE_MS='1000';
const fixture=spawn('./tests/desktop-fixture/bin/Debug/net10.0-windows/computer-custom-fixture.exe',['1'],{windowsHide:false,stdio:['pipe','pipe','pipe']});
const lines=readline.createInterface({input:fixture.stdout}),messages=[],waiters=[];
lines.on('line',line=>{const item=JSON.parse(line);if(waiters.length)waiters.shift()(item);else messages.push(item);});
const next=()=>messages.length?Promise.resolve(messages.shift()):Promise.race([
  new Promise(resolve=>waiters.push(resolve)),delay(3000).then(()=>{throw new Error('Fixture response timed out');})]);
const clients=[];const connect=async()=>{const c=await openDesktop();clients.push(c);return c;};
const terminal=new Set(['succeeded','failed','cancelled']);
async function state(client,batch,wanted){
  while(!terminal.has(batch.state)&&(!wanted||batch.state!==wanted))batch=await client.call('wait_batch',{id:batch.id,afterRevision:batch.revision});
  if(wanted)assert.equal(batch.state,wanted,JSON.stringify(batch));return batch;
}
const evidence={timestamp:new Date().toISOString(),installedSourceId:fs.readFileSync(path.join(path.dirname(installedHelperPath()),'build-id.txt'),'utf8').trim(),cases:[]};
const control=new CoordinatorClient();
try{
  const ready=await next(),target={...ready.windows[0],pid:ready.pid,processStartTime:ready.processStartTime};
  const b=await connect();assert.equal((await b.call('status')).uiAccess,true,'signed helper required for actual input blocking');
  await b.call('desktop_settings',{maxControlMs:1500});
  await control.request('hello',{});
  let expectedB=0;
  const hold=async(client,title)=>client.call('prepare_batch',{title,actions:[{op:'focus_window',target,args:{}},
    {op:'wait_for',target,args:{name:'Deliberately absent recovery control',timeoutMs:10000}}],flush:true});
  const queued=async()=>b.call('prepare_batch',{title:'Verify released input',actions:[{op:'click',target,args:target.a}],flush:true});
  for(const mode of ['cancel','disconnect','coordinator-crash','timeout']){
    fixture.stdin.write('state\n');const baseline=(await next()).windows[0].aCount;
    const a=await connect();let first=await hold(a,`Recovery test: ${mode}`);first=await state(a,first,'running');
    let following=await queued();const began=performance.now();
    if(mode==='cancel')await a.call('cancel_batch',{id:first.id});
    if(mode==='disconnect')await a.close();
    if(mode==='coordinator-crash'){
      const pid=(await control.request('hello',{})).result.pid;control.stop();process.kill(pid);await delay(200);
      // Old history is deliberately unavailable. The adapter reports this once
      // and clears it, allowing a fresh observation rather than an endless loop.
      let fresh=false,lossReported=false;
      for(let attempt=0;attempt<3&&!fresh;attempt++){
        try{await b.call('observe',{target,mode:'tree',depth:3,maxNodes:40});fresh=true;}
        catch(error){assert.match(String(error),/CONNECTION|BATCH_STATE_LOST|ENOENT|NO_BATCH/);lossReported=true;}
      }
      assert.ok(fresh&&lossReported);
      fixture.stdin.write('state\n');const afterCrash=(await next()).windows[0].aCount;
      assert.ok(afterCrash===baseline||afterCrash===baseline+1,'unknown crash progress must be measured before preparing a replacement');
      if(afterCrash===baseline)following=await queued();
      else{
        // The old click already landed before process death. Prove release
        // with a DIFFERENT effect; never replay completed work after lost history.
        expectedB++;following=await b.call('prepare_batch',{title:'Verify release after observed completed click',actions:[{op:'click',target,args:target.b}],flush:true});
      }
    }
    following=await state(b,following);assert.equal(following.state,'succeeded',JSON.stringify(following));
    if(mode==='timeout'){first=await state(a,first);assert.equal(first.state,'failed');assert.ok(Date.parse(first.finishedAt)-Date.parse(first.startedAt)<2200);}
    evidence.cases.push({mode,recovered:true,recoveryMs:performance.now()-began,reacquiredInputMode:following.settings.inputMode});
    fixture.stdin.write('state\n');assert.equal((await next()).windows[0].aCount,baseline+1);
    await a.close();
  }
  fixture.stdin.write('state\n');const observed=await next();assert.equal(observed.windows[0].aCount,4);assert.equal(observed.windows[0].bCount,expectedB);
  evidence.accurate=true;fs.mkdirSync('.cache/evidence',{recursive:true});fs.writeFileSync('.cache/evidence/recovery.json',JSON.stringify(evidence,null,2));
  console.log(JSON.stringify(evidence));
}finally{
  control.stop();for(const client of clients)await client.close();fixture.kill();lines.close();
  await delay(1800);
  if(path.resolve(data).startsWith(cache+path.sep))try{fs.rmSync(data,{recursive:true,force:true});}catch{/* retain diagnostics if a process has not retired */}
}
