import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import readline from 'node:readline';
import path from 'node:path';
import { test } from 'node:test';
import { HelperProcess } from '../build/server/helper-process.mjs';
process.env.COMPUTER_CUSTOM_ELEVATED='0';
test('observations of different windows coexist; refreshing one invalidates only that view',async()=>{
  const fixture=spawn('./tests/desktop-fixture/bin/Debug/net10.0-windows/computer-custom-fixture.exe',['1,1','--hidden'],
    {windowsHide:true,stdio:['pipe','pipe','pipe']});
  const lines=readline.createInterface({input:fixture.stdout});
  const ready=JSON.parse((await once(lines,'line'))[0]);
  const helper=new HelperProcess({executablePath:path.resolve('dist/computer-custom/helper/computer-custom-helper.exe')});
  const read=async(index)=>(await helper.call('ui_tree',{handle:ready.windows[index].handle,depth:3,interactiveOnly:false})).result;
  try {
    const first=await read(0);
    const second=await read(1);
    const resolved=(await helper.call('resolve_element',{elementId:first.root.elementId})).result;
    assert.equal(resolved.target.handle,ready.windows[0].handle);
    assert.equal(resolved.target.pid,ready.pid);
    assert.equal(resolved.target.processStartTime,ready.processStartTime);
    await read(0);
    await assert.rejects(helper.call('resolve_element',{elementId:first.root.elementId}),e=>e.code==='STALE_HANDLE');
    const retained=(await helper.call('resolve_element',{elementId:second.root.elementId})).result;
    assert.equal(retained.target.handle,ready.windows[1].handle);
  } finally {helper.stop();fixture.kill();lines.close();}
});
