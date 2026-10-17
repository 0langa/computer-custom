// Opt-in desktop integration: a coloured fixture is completely covered by a
// different coloured window. WGC must return the target, not the covering UI.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import readline from 'node:readline';
import { DesktopWorkers } from '../build/server/desktop-workers.mjs';
import { observe } from '../build/server/observe.mjs';
process.env.COMPUTER_CUSTOM_ELEVATED='0';
const fixturePath=path.resolve('tests/desktop-fixture/bin/Debug/net10.0-windows/computer-custom-fixture.exe');
execFileSync('dotnet',['build','tests/desktop-fixture','--nologo','-v:q'],{windowsHide:true,stdio:'pipe'});
fs.mkdirSync('.cache/evidence',{recursive:true});
const children=[];
process.env.COMPUTER_CUSTOM_HELPER=path.resolve('dist/computer-custom/helper/computer-custom-helper.exe');
const helper=new DesktopWorkers();
async function window(...args) {
  const child=spawn(fixturePath,['1',...args],{windowsHide:false,stdio:['pipe','pipe','pipe']});
  const lines=readline.createInterface({input:child.stdout});
  children.push({child,lines});
  const ready=JSON.parse((await once(lines,'line'))[0]);
  return {...ready.windows[0],pid:ready.pid,processStartTime:ready.processStartTime};
}
function pixel(file,x,y) {
  return JSON.parse(execFileSync(fixturePath,['--pixel',path.resolve(file),String(x),String(y)],{windowsHide:true,encoding:'utf8'}));
}
try {
  const target=await window();
  await window('--cover');
  await new Promise(resolve=>setTimeout(resolve,150));
  const covered=await helper.call('screenshot',{x:target.x+target.probe.x,y:target.y+target.probe.y,width:1,height:1});
  fs.writeFileSync('.cache/evidence/capture-cover.png',covered.binary);
  assert.deepEqual(pixel('.cache/evidence/capture-cover.png',0,0),{r:19,g:71,b:181},'desktop pixel must belong to cover');
  const at=performance.now();
  const captured=await helper.call('window_capture',{target},{timeoutMs:2000});
  const durationMs=performance.now()-at;
  assert.equal(captured.result.backend,'wgc');
  fs.writeFileSync('.cache/evidence/window-capture.png',captured.binary);
  assert.deepEqual(pixel('.cache/evidence/window-capture.png',target.probe.x-captured.result.offsetX,target.probe.y-captured.result.offsetY),
    {r:203,g:52,b:117},'window capture must contain the occluded target');
  console.log(JSON.stringify({accurate:true,occluded:true,durationMs,...captured.result}));
  const combined=await observe(helper,{target});
  assert.equal(combined.result.partial,false);
  assert.ok(combined.binary?.length);
  assert.ok(combined.result.elements.some(e=>e.name==='A' && e.role==='button'));
  console.log(JSON.stringify({combined:true,durationMs:combined.result.durationMs,elements:combined.result.elements.length,errors:combined.result.errors}));
} finally {
  helper.stop();
  for(const {child,lines} of children){child.stdin.end('quit\n');child.kill();lines.close();}
}
