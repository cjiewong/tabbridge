import path from 'node:path';
import { stat, realpath } from 'node:fs/promises';
import { fault } from './protocol.mjs';

export async function uploadFiles(params) {
  const { files } = params;
  if (!Array.isArray(files) || files.length > 16 || files.some(file => typeof file !== 'string' || !path.isAbsolute(file) || file.length > 4096 || file.includes('\0'))) {
    throw fault('INVALID_PARAMS', 'files must contain at most 16 absolute local file paths; use [] to clear the selection');
  }
  const resolved = [];
  for (const file of files) {
    try {
      const actual = await realpath(file);
      if (!(await stat(actual)).isFile()) throw fault('INVALID_FILE', 'Uploads require regular files, not directories or devices');
      resolved.push(actual);
    } catch (error) {
      if (error.code === 'INVALID_FILE') throw error;
      throw fault('INVALID_FILE', 'An upload file is missing or inaccessible');
    }
  }
  return { ...params, files: resolved };
}
