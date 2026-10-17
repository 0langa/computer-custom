/** Opt-in: trusted flow batching and immediate legacy input through real MCP. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import {spawn} from 'node:child_process';
import {openDesktop} from './interactive-desktop.mjs';
const root=path.resolve('.cache');fs.mkdirSync(root,{recursive:true});
const flows=fs.mkdtempSync(path.join(root,'flow-acceptance-'));process.env.COMPUTER_CUSTOM_FLOWS=flows;
fs.writeFileSync(path.join(flows,'known-steps.mjs'),`export default async cc=>{
  await cc.focus_window({handle:cc.args.handle});
  for(let n=0;n<12;n++)await cc.click(cc.args.points[n%2]);
  return cc.call('flush_batch');
};`);
const fixture=spawn('./tests/desktop-fixture/bin/Debug/net10.0-windows/computer-custom-fixture.exe',['1'],{windowsHide:false,stdio:['pipe','pipe','pipe']});
const lines=readline.createInterface({input:fixture.stdout}),queue=[],waiting=[];
lines.on('line',line=>{const value=JSON.parse(line);if(waiting.length)waiting.shift()(value);else queue.push(value);});
const next=()=>queue.length?Promise.resolve(queue.shift()):new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(new Error('Fixture response timed out')),3000);waiting.push(value=>{clearTimeout(timer);resolve(value);});
});
let desktop;
try{
  const ready=await next(),window=ready.windows[0];desktop=await openDesktop();
  const points=[window.a,window.b].map(p=>({x:window.x+p.x,y:window.y+p.y}));
  const started=performance.now(),flow=await desktop.call('run_flow',{name:'known-steps',args:{handle:window.handle,points}});
  assert.equal(flow.ok,true,JSON.stringify(flow));assert.equal(flow.result.batches.length,1);
  const batch=flow.result.batches[0];assert.equal(batch.state,'succeeded');assert.equal(batch.total,13);
  const flowWallMs=performance.now()-started;
  const directStarted=performance.now(),direct=await desktop.call('click',points[0]);
  const directWallMs=performance.now()-directStarted;assert.equal(direct.state,'succeeded');
  fixture.stdin.write('state\n');const state=await next();assert.equal(state.windows[0].aCount,7);assert.equal(state.windows[0].bCount,6);
  const evidence={timestamp:new Date().toISOString(),accurate:true,flowActions:13,batches:1,flowWallMs,
    flowExecutionMs:Date.parse(batch.finishedAt)-Date.parse(batch.startedAt),countdownMs:batch.settings.countdownMs,directWallMs};
  fs.mkdirSync('.cache/evidence',{recursive:true});fs.writeFileSync('.cache/evidence/saved-flow.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
}finally{
  await desktop?.close();fixture.kill();lines.close();
  if(path.resolve(flows).startsWith(root+path.sep))fs.rmSync(flows,{recursive:true,force:true});
}
