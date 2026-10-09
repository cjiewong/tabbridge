import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { mkdir, lstat, chmod } from 'node:fs/promises';
import { fault } from './protocol.mjs';

export function paths() {
  const home = process.env.TABBRIDGE_HOME || path.join(os.homedir(), '.tabbridge');
  const socket = path.join(home, 'bridge.sock');
  return { home, socket, config: path.join(home, 'config.json') };
}
export async function secureHome(home = paths().home) {
  await mkdir(home, { recursive: true, mode: 0o700 });
  const info = await lstat(home);
  if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid()) throw fault('UNSAFE_HOME', 'Bridge directory must be a real directory owned by the current user');
  await chmod(home, 0o700);
}
export function extensionId(key) {
  return [...createHash('sha256').update(Buffer.from(key, 'base64')).digest().subarray(0, 16)]
    .map(n => String.fromCharCode(97 + (n >> 4), 97 + (n & 15))).join('');
}
