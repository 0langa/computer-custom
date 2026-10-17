import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import readline from 'node:readline';
import { test } from 'node:test';
import { HelperClient } from '../build/server/helper-client.mjs';

async function withHungProvider(run) {
  execFileSync('dotnet', ['build','tests/desktop-fixture','--nologo','-v:q'], {windowsHide:true,stdio:'pipe'});
  const fixture=spawn('./tests/desktop-fixture/bin/Debug/net10.0-windows/computer-custom-fixture.exe',['1','--hang-uia'],
    {windowsHide:true,stdio:['pipe','pipe','pipe']});
  const lines=readline.createInterface({input:fixture.stdout});
  const ready=JSON.parse((await once(lines,'line'))[0]);
  const pipeName=`cc.worker-test.${randomUUID()}`;
  const token=randomUUID();
  const native=spawn('./dist/computer-custom/helper/computer-custom-helper.exe',['--pipe',pipeName,'--parent',String(process.pid)],
    {windowsHide:true,stdio:['pipe','ignore','pipe']});
  const exited=once(native,'exit');
  native.stdin.end(`${token}\n`);
  let client;
  try {
    for(let attempt=0;attempt<100;attempt++) {
      client=new HelperClient({pipePath:`\\\\.\\pipe\\${pipeName}`,token});
      try {await client.connect();break;} catch(error) {client.close();if(attempt===99)throw error;await delay(30);}
    }
    await run({client,exited,handle:ready.windows[0].handle,lines});
  } finally {client?.close();native.kill();fixture.kill();lines.close();}
}

test('a hung accessibility provider cannot outlive the native observation deadline', {timeout:15000}, async () => {
  await withHungProvider(async ({client,exited,handle,lines})=>{
    const entered=once(lines,'line');
    const start=performance.now();
    const pending=client.call('ui_tree',{handle}).catch(()=>{});
    assert.equal(JSON.parse((await entered)[0]).kind,'provider-entered');
    const result=await Promise.race([exited,delay(3200,undefined,{ref:false})]);
    assert.ok(result,'native process must terminate itself even when the caller has not killed it');
    assert.equal(result[0],124,'deadline exit code');
    assert.ok(performance.now()-start<2600,'2s observation deadline plus scheduling tolerance');
    await pending;
  });
});

test('disconnect stops a stuck native operation before its observation deadline', {timeout:15000}, async()=>{
  await withHungProvider(async ({client,exited,handle,lines})=>{
    const entered=once(lines,'line');
    const pending=client.call('ui_tree',{handle}).catch(()=>{});
    assert.equal(JSON.parse((await entered)[0]).kind,'provider-entered');
    client.close();
    const result=await Promise.race([exited,delay(900,undefined,{ref:false})]);
    assert.ok(result,'peer disconnect must terminate an elevated worker without OS kill privileges');
    assert.equal(result[0],125,'disconnect exit code');
    await pending;
  });
});
