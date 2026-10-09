import { mkdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
await mkdir('dist', { recursive: true });
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const result = spawnSync('zip', ['-r', `../dist/tabbridge-extension-${version}.zip`, '.', '-x', '*.DS_Store'], { cwd: 'extension', stdio: 'inherit' });
process.exitCode = result.status;
