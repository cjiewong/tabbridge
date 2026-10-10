import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { extensionFiles } from './release-files.mjs';
import { assertPackageFiles } from './package-files.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const temporary = await mkdtemp(path.join(os.tmpdir(), 'tb-pack-smoke-'));
try {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const [packed] = JSON.parse(execFileSync(npm, ['pack', '--json', '--ignore-scripts', '--pack-destination', temporary], { cwd: root, encoding: 'utf8' }));
  assertPackageFiles(packed);
  execFileSync('tar', ['-xzf', path.join(temporary, packed.filename), '-C', temporary]);
  const extracted = path.join(temporary, 'package');
  const metadata = JSON.parse(await readFile(path.join(extracted, 'package.json'), 'utf8'));
  assert.deepEqual(metadata.dependencies || {}, {});
  for (const name of ['README.md', 'README.zh-CN.md', 'LICENSE', 'SECURITY.md', 'CHANGELOG.md', ...extensionFiles.map(name => `extension/${name}`)]) {
    await readFile(path.join(extracted, name));
  }
  const env = { ...process.env, TABBRIDGE_HOME: path.join(temporary, 'bridge') };
  const run = args => execFileSync(process.execPath, ['bin/tabbridge.mjs', ...args], { cwd: extracted, env, encoding: 'utf8' });
  assert.equal(run(['--version']).trim(), metadata.version);
  assert.match(run(['help']), /TabBridge/);
  assert.ok(JSON.parse(run(['tools'])).some(tool => tool.name === 'browser_snapshot'));
  const installed = JSON.parse(run(['setup', '--manifest-dir', path.join(temporary, 'native-manifests')]));
  assert.equal(installed.extensionPath, await realpath(path.join(extracted, 'extension')));
  const native = JSON.parse(await readFile(installed.manifestPath, 'utf8'));
  assert.deepEqual(native.allowed_origins, [`chrome-extension://${installed.extensionId}/`]);
  assert.equal(JSON.parse(run(['uninstall'])).removed, true);
  console.log(`Packed CLI/setup smoke check passed (${packed.entryCount} files; no runtime dependencies)`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
