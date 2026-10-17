import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { helperBuildId } from './helper-build-id.mjs';
import { writeProvenance } from './write-provenance.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function publishHelpers(root = repoRoot, run = execFileSync) {
  const dist = path.join(root, 'dist', 'computer-custom');
  fs.mkdirSync(dist, { recursive: true });
  const stage = fs.mkdtempSync(path.join(dist, '.native-'));
  const destination = path.join(dist, 'helper');
  const backup = path.join(stage, 'previous');
  const sourceDir = path.join(root, 'helper', 'ComputerCustom.Helper');
  const sourceId = helperBuildId(sourceDir);
  const overlayDir=path.join(root,'helper','ComputerCustom.Overlay'),overlaySourceId=helperBuildId(overlayDir);
  try {
    for (const project of ['ComputerCustom.Helper', 'ComputerCustom.Overlay']) {
      run('dotnet', ['publish', path.join(root, 'helper', project), '-c', 'Release',
        `-p:SourceRevisionId=${sourceId}`, '-o', stage, '--nologo', '-v', 'q'],
      { stdio: 'inherit', windowsHide: true });
    }
    if (helperBuildId(sourceDir) !== sourceId||helperBuildId(overlayDir)!==overlaySourceId) throw new Error('Native source changed during publish');
    writeProvenance(stage, sourceId,overlaySourceId);
    // Preserve the previous complete publish if either build or replacement fails.
    if (fs.existsSync(destination)) fs.renameSync(destination, backup);
    try {
      fs.mkdirSync(destination);
      for (const name of fs.readdirSync(stage)) {
        if (name !== 'previous') fs.renameSync(path.join(stage, name), path.join(destination, name));
      }
    } catch (error) {
      fs.rmSync(destination, { recursive: true, force: true });
      if (fs.existsSync(backup)) fs.renameSync(backup, destination);
      throw error;
    }
  } finally {
    // stage is a fresh child of the exact package destination, never user input.
    fs.rmSync(stage, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  publishHelpers();
}
