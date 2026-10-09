import { readdir, readFile, access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = `${dir}/${entry.name}`;
    if (entry.isDirectory()) await walk(p);
    else if (/\.(mjs|js)$/.test(p)) { const result = spawnSync(process.execPath, ['--check', p], { stdio: 'inherit' }); if (result.status) process.exit(result.status); }
  }
}
for (const dir of ['bin', 'lib', 'extension', 'scripts', 'test']) await walk(dir);
const manifest = JSON.parse(await readFile('extension/manifest.json', 'utf8'));
for (const resource of [manifest.background.service_worker, manifest.action.default_popup, ...Object.values(manifest.icons || {})]) await access(`extension/${resource}`);
console.log('JavaScript syntax checks passed');
