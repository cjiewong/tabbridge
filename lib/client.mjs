import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import { frame, FrameDecoder, fault, validateRequest } from './protocol.mjs';
import { paths } from './paths.mjs';

export async function request(method, params = {}, { session = 'default', timeout = 20_000, socketPath = paths().socket } = {}) {
  const message = { id: randomUUID(), method, params, session };
  validateRequest(message);
  let info;
  try { info = await lstat(socketPath); } catch { throw fault('NOT_CONNECTED', 'Open TabBridge in Chrome and press Connect. Run tabbridge doctor for details.'); }
  if (!info.isSocket() || info.uid !== process.getuid() || (info.mode & 0o077)) throw fault('UNSAFE_SOCKET', 'Bridge socket must be owned by the current user with mode 0600');
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath); const decoder = new FrameDecoder();
    let settled = false;
    const finish = (error, result) => { if (settled) return; settled = true; clearTimeout(timer); socket.destroy(); error ? reject(error) : resolve(result); };
    const timer = setTimeout(() => finish(fault('TIMEOUT', 'Browser did not respond. The action may have executed; inspect state before retrying.')), timeout);
    socket.on('connect', () => socket.write(frame(message)));
    socket.on('error', e => finish(fault('NOT_CONNECTED', e.message)));
    socket.on('close', () => finish(fault('DISCONNECTED', 'Bridge disconnected. Do not repeat a write action without checking the page.')));
    decoder.on('error', e => finish(e));
    decoder.on('data', reply => {
      if (reply.id !== message.id) return;
      finish(reply.error ? fault(reply.error.code, reply.error.message) : null, reply.result);
    });
    socket.pipe(decoder);
  });
}
