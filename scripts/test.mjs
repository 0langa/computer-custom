import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
// UIA providers, foreground state and global hotkeys share a real desktop.
// A deliberately hung provider can affect unrelated UIA initialization.
// Keep integration files serial; intentional competition lives inside tests.
const integration=new Set(['coordinator-bootstrap','elevation','native-control','native-worker','overlay','packaged-helper','uia-snapshots']);
const files=fs.readdirSync('tests').filter(name=>name.endsWith('.test.mjs')).sort();
for(const native of [false,true]){
  const selected=files.filter(name=>integration.has(name.replace('.test.mjs',''))===native);
  const result=spawnSync(process.execPath,['--test',`--test-concurrency=${native?1:4}`,...selected.map(name=>`tests/${name}`)],{stdio:'inherit',windowsHide:true});
  if(result.error)throw result.error;if(result.status!==0)process.exit(result.status??1);
}
