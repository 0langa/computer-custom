import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import readline from 'node:readline';
import path from 'node:path';
import { test } from 'node:test';
import { HelperProcess } from '../build/server/helper-process.mjs';
process.env.COMPUTER_CUSTOM_ELEVATED='0';
test('observations of different windows coexist; refreshing one invalidates only that view',{timeout:30000},async()=>{
  const fixture=spawn('./tests/desktop-fixture/bin/Debug/net10.0-windows/computer-custom-fixture.exe',['0,0','--hidden'],
    {windowsHide:true,stdio:['pipe','pipe','pipe']});
  const lines=readline.createInterface({input:fixture.stdout});
  const helper=new HelperProcess({executablePath:path.resolve('dist/computer-custom/helper/computer-custom-helper.exe')});
  try {
    // Two windows are required; a second physical display is not.
    const ready=JSON.parse((await once(lines,'line',{signal:AbortSignal.timeout(5000)}))[0]);
    const read=async(index)=>(await helper.call('ui_tree',{handle:ready.windows[index].handle,depth:3,interactiveOnly:false})).result;
    const first=await read(0);
    for(let n=0;n<35;n++)await helper.call('ui_tree',{handle:ready.windows[0].handle,depth:3,interactiveOnly:false,internalQuery:true});
    assert.equal((await helper.call('resolve_element',{elementId:first.root.elementId})).result.target.handle,ready.windows[0].handle);
    assert.equal((await helper.call('ui_tree',{handle:ready.windows[1].handle,depth:1,interactiveOnly:false})).result.truncated,true);
    const second=await read(1);
    const resolved=(await helper.call('resolve_element',{elementId:first.root.elementId})).result;
    assert.equal(resolved.target.handle,ready.windows[0].handle);
    assert.equal(resolved.target.pid,ready.pid);
    assert.equal(resolved.target.processStartTime,ready.processStartTime);
    await assert.rejects(helper.call('invoke_element',{elementId:first.root.elementId,prepared:true,
      target:{handle:ready.windows[1].handle,pid:ready.pid,processStartTime:ready.processStartTime}}),
      e=>e.code==='STALE_HANDLE');
    await read(0);
    await assert.rejects(helper.call('resolve_element',{elementId:first.root.elementId}),e=>e.code==='STALE_HANDLE');
    const retained=(await helper.call('resolve_element',{elementId:second.root.elementId})).result;
    assert.equal(retained.target.handle,ready.windows[1].handle);
  } finally {helper.stop();fixture.kill();lines.close();}
});
