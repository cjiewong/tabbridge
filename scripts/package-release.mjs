import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, mkdtemp, rename, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { packageExtension } from './package-extension.mjs';
import { assertPackageFiles } from './package-files.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
execFileSync(process.execPath, ['scripts/check.mjs'], { cwd: root, stdio: 'inherit' });
const directory = path.join(root, 'dist');
await mkdir(directory, { recursive: true });
const temporary = await mkdtemp(path.join(directory, '.tabbridge-release-'));
try {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const [packed] = JSON.parse(execFileSync(npm, ['pack', '--json', '--ignore-scripts', '--pack-destination', temporary], { cwd: root, encoding: 'utf8' }));
  assertPackageFiles(packed);
  const archive = path.join(temporary, packed.filename);
  const sha256 = createHash('sha256').update(await readFile(archive)).digest('hex');
  const extension = await packageExtension();
  await rename(archive, path.join(directory, packed.filename));
  await writeFile(path.join(directory, `${packed.filename}.sha256`), `${sha256}  ${packed.filename}\n`, { mode: 0o644 });
  console.log(JSON.stringify({ extension, cli: { filename: packed.filename, sha256 } }, null, 2));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
