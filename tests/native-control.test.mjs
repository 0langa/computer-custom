import assert from 'node:assert/strict';
import path from 'node:path';
import { test, after } from 'node:test';
import { HelperProcess } from '../build/server/helper-process.mjs';

process.env.COMPUTER_CUSTOM_ELEVATED = '0';
const helper = new HelperProcess({ executablePath: path.resolve('dist/computer-custom/helper/computer-custom-helper.exe') });
after(() => helper.stop());

test('input step cannot execute without an active native control lease', async () => {
  await assert.rejects(helper.call('execute_step', { op: 'click', x: 0, y: 0 }),
    error => error.code === 'CONTROL_REQUIRED');
});

test('invalid control duration is rejected before acquiring input devices', async () => {
  for (const durationMs of [0, -1, 10001]) {
    await assert.rejects(helper.call('begin_control', { durationMs, inputMode: 'block' }),
      error => error.code === 'BAD_ARGS' && /duration/i.test(error.message));
  }
});

test('window targets identify the process lifetime and reject a reused handle', async () => {
  const windows = (await helper.call('list_windows')).result;
  const target = windows.find(w => w.processStartTime);
  assert.ok(target, 'expected at least one observable window with process identity');
  const resolved = (await helper.call('resolve_target', { target })).result;
  assert.equal(resolved.handle, target.handle);
  await assert.rejects(helper.call('resolve_target', {
    target: { ...target, pid: target.pid + 1 },
  }), error => error.code === 'STALE_HANDLE');
  await assert.rejects(helper.call('resolve_target', {
    target: { ...target, processStartTime: '0' },
  }), error => error.code === 'STALE_HANDLE');
});

test('relative input coordinates resolve on the current window and reject out-of-window points', async () => {
  const target = (await helper.call('list_windows')).result.find(w => w.processStartTime && w.width > 0);
  assert.ok(target);
  const resolved = (await helper.call('resolve_target', { target, x: 1, y: 1 })).result;
  assert.equal(resolved.screenX, resolved.x + 1);
  assert.equal(resolved.screenY, resolved.y + 1);
  await assert.rejects(helper.call('resolve_target', { target, x: -1, y: 0 }),
    error => error.code === 'BAD_ARGS');
});

test('a new UI observation cannot reuse element ids from the previous generation', async () => {
  const windows = (await helper.call('list_windows')).result;
  const target = windows.find(w => w.foreground && w.processStartTime) ?? windows.find(w => w.processStartTime);
  const first = (await helper.call('ui_tree', { handle: target.handle, depth: 4, interactiveOnly: false })).result;
  const second = (await helper.call('ui_tree', { handle: target.handle, depth: 4, interactiveOnly: false })).result;
  assert.ok(first.observationId, 'observation must have a generation identity');
  assert.notEqual(second.observationId, first.observationId);
  assert.notEqual(first.root.elementId, second.root.elementId);
  await assert.rejects(helper.call('invoke_element', { elementId: first.root.elementId }),
    e => e.code === 'STALE_HANDLE');
});
