import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function writeProvenance(directory, sourceId) {
  if (!/^[a-f0-9]{16}$/.test(sourceId)) throw new Error('Invalid source identity');
  const files = {};
  for (const name of fs.readdirSync(directory).sort()) {
    if (!/\.(exe|dll)$/.test(name)) continue;
    files[name] = crypto.createHash('sha256').update(fs.readFileSync(path.join(directory, name))).digest('hex');
  }
  if (!files['computer-custom-helper.exe'] || !files['computer-custom-helper.dll']) {
    throw new Error('No complete helper binary to identify');
  }
  fs.writeFileSync(path.join(directory, 'provenance.json'), JSON.stringify({
    schema: 1, sourceId, builtAt: new Date().toISOString(), files,
  }, null, 2) + '\n');
  fs.writeFileSync(path.join(directory, 'build-id.txt'), sourceId + '\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  writeProvenance(process.argv[2], process.argv[3]);
}
