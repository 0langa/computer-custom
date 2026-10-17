/** Opt-in: requires the owned browser-fixture page already open on HUAWEI. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {openDesktop} from './interactive-desktop.mjs';
import {setTimeout as delay} from 'node:timers/promises';
const normal=process.argv.includes('--normal');
const desktop=await openDesktop(normal?{elevated:false,helper:path.resolve('helper/ComputerCustom.Helper/bin/Debug/net10.0-windows10.0.19041.0/computer-custom-helper.exe')}:{});
try{
  const windows=await desktop.call('list_windows');
  const target=windows.find(w=>w.process==='chrome'&&w.x<0&&w.width>900&&w.title.startsWith('Computer Custom browser fixture'));
  assert.ok(target,'Open tests/browser-fixture/index.html in the isolated browser on HUAWEI first');
  let before,input,canvas;const readyUntil=performance.now()+5000;
  do{
    before=await desktop.call('observe',{target,mode:'tree',depth:25,maxNodes:250});
    input=before.elements.find(e=>e.name==='Keyboard input'&&e.role==='edit');
    canvas=before.elements.find(e=>e.name==='Drawing surface');
    if(input&&canvas)break;await delay(25);
  }while(performance.now()<readyUntil);
  if(!input||!canvas){fs.writeFileSync('.cache/browser-not-ready.json',JSON.stringify(before,null,2));assert.fail('Owned browser fixture controls did not become ready');}
  const batch=await desktop.run([
    {op:'click',target,args:{x:input.bounds.x+60,y:input.bounds.y+30}},
    {op:'key',target,args:{keys:['ctrl',',']}},
    {op:'drag',target,args:{fromX:canvas.bounds.x+20,fromY:canvas.bounds.y+20,toX:canvas.bounds.x+600,toY:canvas.bounds.y+200}},
  ],'Verify browser chord and canvas events',{inputMode:normal?'ignore':'block'});
  const after=await desktop.call('observe',{target,mode:'tree',depth:25,maxNodes:250});
  const value=name=>after.elements.find(e=>e.role==='edit'&&e.name===name)?.value??'[]';
  const keys=JSON.parse(value('Keyboard events')).slice(-4),pointer=JSON.parse(value('Pointer events'));
  const evidence={timestamp:new Date().toISOString(),normal,executionMs:Date.parse(batch.finishedAt)-Date.parse(batch.startedAt),keys,pointer,batch};
  fs.mkdirSync('.cache/evidence',{recursive:true});fs.writeFileSync(`.cache/evidence/browser-input-${normal?'normal':'uiaccess'}.json`,JSON.stringify(evidence,null,2));
  assert.deepEqual(keys.map(k=>[k.type,k.code]),[['keydown','ControlLeft'],['keydown','Comma'],['keyup','Comma'],['keyup','ControlLeft']]);
  const start=pointer.findLastIndex(e=>e.type==='pointerdown'),stroke=pointer.slice(start);
  assert.equal(stroke[0]?.type,'pointerdown');assert.equal(stroke.at(-1)?.type,'pointerup');
  assert.ok(stroke.some(e=>e.type==='pointermove'));assert.ok(Math.abs(stroke.at(-1).x-598)<2);
  console.log(JSON.stringify({success:true,normal,executionMs:evidence.executionMs,keyCodes:keys.map(k=>k.code),pointerEvents:stroke.length}));
}finally{await desktop.close();}
