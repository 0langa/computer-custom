// Live, opt-in fixture test. Only our own clearly labelled windows receive input.
// Usage: node scripts/verify-native-input.mjs [screen-index-list] [block|ignore]
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import readline from 'node:readline';
import { HelperProcess } from '../build/server/helper-process.mjs';

const screens = process.argv[2] ?? '1';
const mode = process.argv[3] ?? 'block';
const fixturePath = path.resolve('tests/desktop-fixture/bin/Debug/net10.0-windows/computer-custom-fixture.exe');
// This is the visible interactive test surface, not a background helper.
const fixture = spawn(fixturePath, [screens], { windowsHide: false, stdio: ['pipe', 'pipe', 'pipe'] });
const lines = readline.createInterface({ input: fixture.stdout });
const waiting = [];
const messages = [];
lines.on('line', line => {
  const value = JSON.parse(line);
  const waiter = waiting.shift();
  if (waiter) waiter(value); else messages.push(value);
});
fixture.stderr.on('data', data => process.stderr.write(data));
const next = () => messages.length ? Promise.resolve(messages.shift()) : new Promise(resolve => waiting.push(resolve));
const helper = new HelperProcess({ executablePath: path.resolve('dist/computer-custom/helper/computer-custom-helper.exe') });
let lease;
let currentStep;
let completed = 0;
try {
  const initial = await next();
  const targets = initial.windows.map(w => ({ ...w, pid: initial.pid, processStartTime: initial.processStartTime }));
  console.log(JSON.stringify({ fixture: targets.map(t => ({handle:t.handle, x:t.x,y:t.y,a:t.a,b:t.b})) }));
  const status = (await helper.call('ping')).result;
  const visible = (await helper.call('list_windows')).result;
  for (const target of targets) assert.ok(visible.some(w => w.handle === target.handle), 'Fixture must be visible before input');
  console.log(JSON.stringify({ screens, mode, uiAccess: status.uiAccess, power: status.power }));
  // Announce before every live takeover; no native scheduler integration yet.
  console.log('Fixture input starts in 15 seconds; close the fixture to cancel.');
  await new Promise(resolve => setTimeout(resolve, 15000));
  const started = performance.now();
  lease = (await helper.call('begin_control', { inputMode: mode, durationMs: 10000 })).result;
  const timings = [];
  for (let i = 0; i < 20; i++) {
    for (const target of targets) {
      currentStep = { index: i, screen: target.screen, handle: target.handle };
      const at = performance.now();
      await helper.call('execute_step', { leaseId: lease.leaseId, target, op: 'click', args: i % 2 ? target.b : target.a });
      timings.push(performance.now() - at);
      completed++;
    }
  }
  await helper.call('end_control', { leaseId: lease.leaseId });
  lease = undefined;
  const executionMs = performance.now() - started;
  // WinForms consumes input messages asynchronously after SendInput returns.
  await new Promise(resolve => setTimeout(resolve, 150));
  fixture.stdin.write('state\n');
  const final = await next();
  for (const w of final.windows) {
    assert.equal(w.aCount, 10, `screen ${w.screen} A count`);
    assert.equal(w.bCount, 10, `screen ${w.screen} B count`);
    assert.deepEqual(w.events.map(e => e.control), Array.from({length: 20}, (_, i) => i % 2 ? 'B' : 'A'));
  }
  const sorted = timings.toSorted((a, b) => a - b);
  const result = { timestamp: new Date().toISOString(), sourceId: fs.readFileSync('dist/computer-custom/helper/build-id.txt','utf8').trim(),
    mode, screens, operations: timings.length, executionMs, medianMs: sorted[Math.floor(sorted.length / 2)],
    p95Ms: sorted[Math.ceil(sorted.length * .95) - 1], accurate: true, status,
    inputInterferenceTested: false };
  fs.mkdirSync('.cache/evidence', { recursive: true });
  fs.writeFileSync(`.cache/evidence/native-${mode}-${screens.replaceAll(',', '-')}.json`, JSON.stringify(result,null,2));
  console.log(JSON.stringify(result));
} catch (error) {
  console.error(JSON.stringify({currentStep,completed,foreground: (await helper.call('foreground_window').catch(()=>({}))).result}));
  if (lease) await helper.call('end_control', { leaseId: lease.leaseId }).catch(() => {});
  lease = undefined;
  const screenshot = await helper.call('screenshot').catch(() => undefined);
  fs.mkdirSync('.cache/evidence', { recursive: true });
  if (screenshot?.binary) fs.writeFileSync('.cache/evidence/native-failure.png', screenshot.binary);
  throw error;
} finally {
  if (lease) await helper.call('end_control', { leaseId: lease.leaseId }).catch(() => {});
  helper.stop();
  fixture.stdin.end('quit\n');
  fixture.kill();
  lines.close();
}
