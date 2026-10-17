import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { helperBuildId } from '../scripts/helper-build-id.mjs';

const root = path.resolve('dist/computer-custom');

test('installed package can compute the build id of its included elevation source', () => {
  const source = path.join(root, 'helper-source/ComputerCustom.Helper');
  assert.ok(fs.existsSync(path.join(source, 'ComputerCustom.Helper.csproj')),
    'elevation installer must have a complete project, not only a compiled helper');
  const actual = execFileSync(process.execPath,
    [path.join(root, 'scripts/helper-build-id.mjs'), source], { encoding: 'utf8', cwd: 'C:/' }).trim();
  assert.equal(actual, helperBuildId());
  assert.ok(fs.existsSync(path.join(root, 'scripts/uac-secure-desktop.ps1')));
});

test('packaged provenance identifies the bytes of every shipped native executable and assembly', () => {
  const file = path.join(root, 'helper/provenance.json');
  assert.ok(fs.existsSync(file), 'native publish must record binary provenance');
  const provenance = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(provenance.sourceId, helperBuildId());
  assert.equal(provenance.overlaySourceId,helperBuildId(path.resolve('helper/ComputerCustom.Overlay')));
  assert.equal(fs.readFileSync(path.join(root, 'helper/build-id.txt'), 'utf8').trim(), provenance.sourceId);
  for (const name of fs.readdirSync(path.join(root, 'helper')).filter(n => /\.(exe|dll)$/.test(n))) {
    const bytes = fs.readFileSync(path.join(root, 'helper', name));
    assert.equal(provenance.files[name], crypto.createHash('sha256').update(bytes).digest('hex'), name);
  }
});
