import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { loadDesktopSettings, saveDesktopSettings, desktopSettingsPath } from '../build/server/desktop-settings.mjs';

test('desktop defaults match the approved takeover behavior',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cc-settings-'));
  try {
    assert.deepEqual(loadDesktopSettings(path.join(dir,'settings.json')),{
      batchThreshold:5,countdownMs:5000,snoozeMs:300000,maxControlMs:10000,inputMode:'block',
    });
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
test('settings persist outside the plugin and reject an unbounded takeover',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cc-settings-'));
  const file=path.join(dir,'nested','settings.json');
  try {
    saveDesktopSettings({batchThreshold:8,inputMode:'ignore'},file);
    assert.equal(loadDesktopSettings(file).batchThreshold,8);
    assert.equal(loadDesktopSettings(file).inputMode,'ignore');
    assert.throws(()=>saveDesktopSettings({maxControlMs:10001},file),/10000/);
    assert.equal(loadDesktopSettings(file).maxControlMs,10000);
    assert.ok(!desktopSettingsPath().includes('plugins\\cache'));
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
