/** Opt-in, after returning the HUAWEI Codex window to a chat. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {openDesktop} from './interactive-desktop.mjs';
const desktop=await openDesktop({elevated:false,helper:path.resolve('helper/ComputerCustom.Helper/bin/Debug/net10.0-windows10.0.19041.0/computer-custom-helper.exe')});
try{
  const target=(await desktop.call('list_windows')).find(w=>w.process==='ChatGPT'&&w.x<0&&w.width>900);assert.ok(target);
  const batch=await desktop.run([{op:'key',target,args:{keys:['ctrl',',']}},
    {op:'wait_for',target,args:{name:'Notifications',role:'button',timeoutMs:5000}}],'Verify corrected Codex settings shortcut',{inputMode:'ignore'});
  const view=await desktop.call('observe',{target,mode:'targeted',query:'Search settings',depth:20,maxNodes:600});
  assert.ok(view.elements.some(e=>e.role==='edit'&&e.name==='Search settings'));
  const result={timestamp:new Date().toISOString(),success:true,executionMs:Date.parse(batch.finishedAt)-Date.parse(batch.startedAt),batch};
  fs.mkdirSync('.cache/evidence',{recursive:true});fs.writeFileSync('.cache/evidence/codex-shortcut.json',JSON.stringify(result,null,2));
  console.log(JSON.stringify({success:true,executionMs:result.executionMs}));
}finally{await desktop.close();}
