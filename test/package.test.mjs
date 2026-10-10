import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, writeFile, readFile, rename, rm, symlink } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { packageExtension } from '../scripts/package-extension.mjs';
import { extensionFiles } from '../scripts/release-files.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tb-package-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ version: '1.2.3' }));
  for (const name of extensionFiles) {
    const target = path.join(root, 'extension', name);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, name === 'manifest.json' ? JSON.stringify({ version: '1.2.3' }) : `fixture ${name}\n`);
  }
  return root;
}

test('extension archives are repeatable, allowlisted and discard stale entries', async t => {
  const root = await fixture(t);
  await writeFile(path.join(root, 'extension/.env'), 'not-for-distribution');
  const first = await packageExtension({ root });
  assert.deepEqual(execFileSync('unzip', ['-Z1', first.path], { encoding: 'utf8' }).trim().split('\n'), extensionFiles);
  assert.equal(await readFile(`${first.path}.sha256`, 'utf8'), `${first.sha256}  ${path.basename(first.path)}\n`);
  await writeFile(path.join(root, 'removed.js'), 'stale file');
  execFileSync('zip', ['-q', first.path, 'removed.js'], { cwd: root });
  const second = await packageExtension({ root });
  assert.equal(second.sha256, first.sha256);
  assert.ok(!execFileSync('unzip', ['-Z1', second.path], { encoding: 'utf8' }).includes('removed.js'));
});

test('extension packaging rejects symlinked source files', async t => {
  const root = await fixture(t);
  const target = path.join(root, 'extension/browser.js');
  await rm(target);
  await symlink(path.join(root, 'package.json'), target);
  await assert.rejects(packageExtension({ root }), /regular file/);
});

test('extension packaging also rejects symlinked resource directories', async t => {
  const root = await fixture(t);
  const icons = path.join(root, 'extension/icons');
  const outside = path.join(root, 'outside-icons');
  await rename(icons, outside);
  await symlink(outside, icons);
  await assert.rejects(packageExtension({ root }), /regular directory/);
});

test('extension packaging refuses mismatched versions', async t => {
  const root = await fixture(t);
  await writeFile(path.join(root, 'extension/manifest.json'), JSON.stringify({ version: '1.2.4' }));
  await assert.rejects(packageExtension({ root }), /versions must match/);
});
