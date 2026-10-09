import { Transform } from 'node:stream';

export const VERSION = '0.1.0';
export const PROTOCOL = 1;
export const HOST = 'io.github.cjiewong.tabbridge';
export const MAX_FRAME = 8 * 1024 * 1024;
export const METHODS = new Set(['status', 'tabs', 'open', 'claim', 'release', 'close', 'navigate', 'back', 'forward', 'reload', 'snapshot', 'click', 'fill', 'press', 'scroll', 'select', 'screenshot', 'wait', 'dialog', 'logs', 'evaluate', 'batch']);
export function fault(code, message) { return Object.assign(new Error(message), { code }); }
export function errorData(error) { return { code: error.code || 'ERROR', message: error.message || String(error) }; }
export function frame(value, limit = MAX_FRAME) {
  const data = Buffer.from(JSON.stringify(value));
  if (!data.length || data.length > limit) throw fault('FRAME_LIMIT', `Message exceeds ${limit} bytes`);
  const header = Buffer.alloc(4); header.writeUInt32LE(data.length);
  return Buffer.concat([header, data]);
}
export class FrameDecoder extends Transform {
  constructor(limit = MAX_FRAME) { super({ readableObjectMode: true }); this.buffer = Buffer.alloc(0); this.limit = limit; }
  _transform(chunk, encoding, done) {
    try {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      while (this.buffer.length >= 4) {
        const size = this.buffer.readUInt32LE();
        if (!size || size > this.limit) throw fault('FRAME_LIMIT', 'Invalid message length');
        if (this.buffer.length < 4 + size) break;
        const value = JSON.parse(this.buffer.subarray(4, 4 + size).toString('utf8'));
        this.buffer = this.buffer.subarray(4 + size); this.push(value);
      }
      done();
    } catch (error) { done(error); }
  }
  _flush(done) { done(this.buffer.length ? fault('TRUNCATED_FRAME', 'Connection ended during a message') : null); }
}
export function validateRequest(request) {
  if (!request || typeof request !== 'object' || !METHODS.has(request.method)) throw fault('INVALID_METHOD', 'Unknown browser method');
  if (typeof request.session !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(request.session)) throw fault('INVALID_SESSION', 'Session must be 1–80 letters, numbers, underscores or hyphens');
  if (!request.params || typeof request.params !== 'object' || Array.isArray(request.params)) throw fault('INVALID_PARAMS', 'params must be an object');
}
