import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdir, readFile, lstat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { VERSION, METHODS } from '../lib/protocol.mjs';
import { tools } from '../lib/tools.mjs';
import { extensionFiles, extensionResource } from './release-files.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const files = [];
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(p);
    else {
      files.push(p);
      if (/\.(mjs|js)$/.test(p)) {
        const result = spawnSync(process.execPath, ['--check', p], { stdio: 'inherit' });
        if (result.error) throw result.error;
        if (result.status !== 0) process.exit(result.status || 1);
      }
    }
  }
}
for (const dir of ['bin', 'lib', 'extension', 'scripts', 'test', 'docs', '.github']) await walk(path.join(root, dir));
const json = async name => JSON.parse(await readFile(path.join(root, name), 'utf8'));
const [metadata, lock, manifest] = await Promise.all([json('package.json'), json('package-lock.json'), json('extension/manifest.json')]);
assert.equal(metadata.version, VERSION, 'CLI/MCP version differs from package.json');
assert.equal(manifest.version, VERSION, 'Extension version differs from package.json');
assert.equal(lock.version, VERSION, 'Lockfile version differs from package.json');
assert.equal(lock.packages[''].version, VERSION, 'Lockfile root version differs from package.json');
assert.deepEqual(metadata.dependencies || {}, {}, 'Runtime dependencies require an explicit architectural review');
assert.equal(manifest.manifest_version, 3);
assert.deepEqual(new Set(tools.map(tool => tool.name.slice(8))), METHODS, 'MCP and CLI methods differ');
assert.equal(tools.length, METHODS.size, 'Duplicate MCP tools');

const extensionRoot = path.join(root, 'extension');
async function resource(name) {
  await extensionResource(root, name);
  assert.ok(extensionFiles.includes(name.split(path.sep).join('/')), `Resource is not in the release allowlist: ${name}`);
}
for (const name of extensionFiles) await resource(name);
for (const name of [manifest.background.service_worker, manifest.action.default_popup, ...Object.values(manifest.icons || {}), ...Object.values(manifest.action.default_icon || {})]) await resource(name);
for (const filename of files.filter(name => name.startsWith(extensionRoot + path.sep))) {
  if (path.basename(filename) === '.DS_Store') continue;
  const relative = path.relative(extensionRoot, filename).split(path.sep).join('/');
  assert.ok(extensionFiles.includes(relative), `Unexpected extension file; review before distributing: ${relative}`);
  if (/\.(?:js|html)$/.test(filename)) {
    const text = await readFile(filename, 'utf8');
    const pattern = filename.endsWith('.js') ? /\b(?:from|import)\s*['"](\.[^'"]+)['"]/g : /\b(?:src|href)=["']([^"']+)["']/g;
    for (const match of text.matchAll(pattern)) {
      if (/^(?:https?:|#|data:)/.test(match[1])) continue;
      await resource(path.relative(extensionRoot, path.resolve(path.dirname(filename), match[1])));
    }
  }
}

for (const entry of await readdir(root)) if (entry.endsWith('.md')) files.push(path.join(root, entry));
let links = 0;
for (const filename of files.filter(name => name.endsWith('.md'))) {
  const text = (await readFile(filename, 'utf8')).replace(/```[\s\S]*?```/g, '');
  for (const match of text.matchAll(/!?\[[^\]]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)) {
    const target = match[1].split('#')[0];
    if (!target || /^[a-z][a-z\d+.-]*:/i.test(target)) continue;
    await lstat(path.resolve(path.dirname(filename), decodeURIComponent(target)));
    links++;
  }
}
console.log(`Syntax, versions, MCP tools, release resources and ${links} local documentation links passed`);
