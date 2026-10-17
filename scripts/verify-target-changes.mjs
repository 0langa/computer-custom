/** Opt-in: geometry, modal and occlusion acceptance on the second display. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import readline from 'node:readline';
import {spawn} from 'node:child_process';
import {openDesktop} from './interactive-desktop.mjs';
import path from 'node:path';
function fixture(extra=[]){
  const child=spawn('./tests/desktop-fixture/bin/Debug/net10.0-windows/computer-custom-fixture.exe',['1',...extra],{windowsHide:false,stdio:['pipe','pipe','pipe']});
  const lines=readline.createInterface({input:child.stdout}),queue=[],waiters=[];
  lines.on('line',line=>{const value=JSON.parse(line);if(waiters.length)waiters.shift()(value);else queue.push(value);});
  const next=()=>queue.length?Promise.resolve(queue.shift()):new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Fixture response timed out')),3000);waiters.push(value=>{clearTimeout(timer);resolve(value);});
  });
  return {next,command:async text=>{child.stdin.write(text+'\n');return next();},close:()=>{child.kill();lines.close();}};
}
const normal=process.argv.includes('--normal');
const modalOnly=process.argv.includes('--modal-only');
const f=fixture(),desktop=await openDesktop(normal?{elevated:false,helper:path.resolve('helper/ComputerCustom.Helper/bin/Debug/net10.0-windows10.0.19041.0/computer-custom-helper.exe')}:{});let cover;
try{
  const ready=await f.next(),original=ready.windows[0],target={...original,pid:ready.pid,processStartTime:ready.processStartTime};
  const evidence={timestamp:new Date().toISOString(),normal,cases:[],displayScales:(await desktop.call('status')).displays.map(d=>d.scale),mixedDpiTested:false};
  const prepare=args=>desktop.call('prepare_batch',{inputMode:normal?'ignore':'block',...args});
  const finish=async initial=>{let b=initial;while(!['succeeded','failed','cancelled'].includes(b.state))b=await desktop.call('wait_batch',{id:b.id,afterRevision:b.revision});return b;};
  const drain=async()=>{try{await desktop.call('flush_batch');}catch{/* expected failure has been reported */}};
  let batch;
  if(!modalOnly){
  batch=await prepare({actions:[{op:'click',target,args:original.a}],flush:false,title:'Moved window target'});
  await f.command(`bounds:${original.x+480},${original.y+120},420,280`);
  batch=await finish(await prepare({id:batch.id,actions:[],flush:true}));assert.equal(batch.state,'succeeded',JSON.stringify(batch));
  assert.equal((await f.command('state')).windows[0].aCount,1);evidence.cases.push({case:'moved-after-prepare',success:true});
  batch=await prepare({actions:[{op:'click',target,args:{x:400,y:100}}],flush:false,title:'Resized window bounds'});
  await f.command(`bounds:${original.x+480},${original.y+120},300,280`);
  batch=await finish(await prepare({id:batch.id,actions:[],flush:true}));assert.equal(batch.state,'failed');assert.equal(batch.error.code,'BAD_ARGS');
  evidence.cases.push({case:'shrunk-after-prepare',success:true,error:batch.error.code});await drain();
  await f.command(`bounds:${original.x},${original.y},420,280`);
  }
  await f.command('modal');
  batch=await finish(await prepare({actions:[{op:'key',target,args:{keys:['enter']}}],flush:true,title:'Unexpected modal target'}));
  assert.equal(batch.state,'failed',JSON.stringify(batch));assert.equal(batch.error.code,'TARGET_DISABLED');
  evidence.cases.push({case:'unexpected-modal',success:true,error:batch.error.code});await drain();
  if(!modalOnly){
  const modal=(await desktop.call('list_windows')).find(w=>w.pid===target.pid&&w.title==='Computer Custom modal fixture');assert.ok(modal);
  await desktop.run([{op:'key',target:modal,args:{keys:['alt','f4']}}],'Close owned modal fixture',{inputMode:normal?'ignore':'block'});
  cover=fixture(['--cover']);const coverReady=await cover.next();
  await cover.command(`bounds:${original.x},${original.y},420,280`);
  await cover.command('raise-cover');
  const occlusionState=(await f.command('state')).windows[0];
  if(occlusionState.hitAtA!==coverReady.windows[0].handle){
    const snapshot=await desktop.raw('screenshot',{x:original.x,y:original.y,width:420,height:280});
    const picture=snapshot.content.find(part=>part.type==='image');if(picture)fs.writeFileSync('.cache/occlusion-debug.png',Buffer.from(picture.data,'base64'));
    console.log(JSON.stringify({windows:(await desktop.call('list_windows')).filter(w=>[target.pid,coverReady.pid].includes(w.pid))}));
  }
  assert.equal(occlusionState.hitAtA,coverReady.windows[0].handle,JSON.stringify({occlusionState,cover:coverReady.windows[0]}));
  batch=await finish(await prepare({actions:[{op:'click',target,args:original.a}],flush:true,title:'Occluded target'}));
  assert.equal(batch.state,'failed');assert.equal(batch.error.code,'TARGET_OCCLUDED');
  assert.equal((await f.command('state')).windows[0].aCount,1);
  evidence.cases.push({case:'occluded-target',success:true,error:batch.error.code});await drain();
  }
  fs.mkdirSync('.cache/evidence',{recursive:true});fs.writeFileSync('.cache/evidence/target-changes.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
}finally{await desktop.close();cover?.close();f.close();}
