import { mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
await mkdir('dist', { recursive: true });
const result = spawnSync('zip', ['-r', '../dist/tabbridge-extension-0.1.0.zip', '.', '-x', '*.DS_Store'], { cwd: 'extension', stdio: 'inherit' });
process.exitCode = result.status;
