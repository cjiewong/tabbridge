import path from 'node:path';
import { lstat } from 'node:fs/promises';

// Keep additions deliberate: extension archives must never include local artifacts.
export const extensionFiles = [
  'background.js',
  'browser.js',
  'icons/128.png',
  'icons/16.png',
  'icons/32.png',
  'icons/48.png',
  'keys.js',
  'manifest.json',
  'network.js',
  'policy.js',
  'popup.css',
  'popup.html',
  'popup.js'
];

export async function extensionResource(root, name) {
  const base = path.resolve(root, 'extension');
  const target = path.resolve(base, name);
  if (!target.startsWith(base + path.sep)) throw new Error(`Resource escapes the extension: ${name}`);
  const parts = path.relative(base, target).split(path.sep);
  let current = base;
  for (let index = -1; index < parts.length; index++) {
    if (index >= 0) current = path.join(current, parts[index]);
    const info = await lstat(current);
    const file = index === parts.length - 1;
    if (info.isSymbolicLink() || (file ? !info.isFile() : !info.isDirectory())) {
      throw new Error(`Release resource must be a regular ${file ? 'file' : 'directory'}: ${name}`);
    }
  }
  return target;
}
