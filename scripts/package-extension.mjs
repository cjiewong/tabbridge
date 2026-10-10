import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, mkdtemp, copyFile, chmod, utimes, rename, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { extensionFiles, extensionResource } from './release-files.mjs';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));

export async function packageExtension({ root = projectRoot, outputDirectory = path.join(root, 'dist') } = {}) {
  const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const manifest = JSON.parse(await readFile(await extensionResource(root, 'manifest.json'), 'utf8'));
  if (manifest.version !== version || !/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Package and extension versions must match');
  await mkdir(outputDirectory, { recursive: true });
  const temporary = await mkdtemp(path.join(outputDirectory, '.tabbridge-pack-'));
  const filename = `tabbridge-extension-${version}.zip`;
  const output = path.join(outputDirectory, filename);
  try {
    const source = path.join(temporary, 'extension');
    for (const name of extensionFiles) {
      const input = await extensionResource(root, name);
      const target = path.join(source, name);
      await mkdir(path.dirname(target), { recursive: true });
      await copyFile(input, target);
      await chmod(target, 0o644);
      // ZIP stores local DOS timestamps. Normalize them for repeatable builds.
      await utimes(target, new Date(1980, 0, 1), new Date(1980, 0, 1));
    }
    const archive = path.join(temporary, filename);
    const result = spawnSync('zip', ['-X', '-q', archive, ...extensionFiles], { cwd: source, encoding: 'utf8' });
    if (result.error) throw new Error('Install the zip command to package the extension', { cause: result.error });
    if (result.status !== 0) throw new Error(`zip failed: ${result.stderr || result.stdout}`);
    await chmod(archive, 0o644);
    const sha256 = createHash('sha256').update(await readFile(archive)).digest('hex');
    await rename(archive, output);
    await writeFile(`${output}.sha256`, `${sha256}  ${filename}\n`, { mode: 0o644 });
    return { path: output, sha256, files: extensionFiles.length };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await packageExtension(), null, 2));
}
