import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { readFile, lstat, unlink, chmod } from 'node:fs/promises';
import { frame, FrameDecoder, fault, errorData, validateRequest, PROTOCOL, VERSION } from './protocol.mjs';
import { paths, secureHome } from './paths.mjs';

export async function nativeHost(origin) {
  const p = paths(); await secureHome();
  const config = JSON.parse(await readFile(p.config, 'utf8'));
  if (origin !== `chrome-extension://${config.extensionId}/`) throw fault('INVALID_ORIGIN', 'Unexpected Chrome extension');
  // Never unlink another running profile's socket. A profile owns one TABBRIDGE_HOME.
  try {
    const old = await lstat(p.socket);
    if (!old.isSocket() || old.uid !== process.getuid()) throw fault('UNSAFE_SOCKET', 'Unexpected socket path');
    const live = await new Promise(resolve => {
      const c = net.createConnection(p.socket); c.once('connect', () => { c.destroy(); resolve(true); });
      c.once('error', e => resolve(e.code !== 'ECONNREFUSED' && e.code !== 'ENOENT')); c.setTimeout(1000, () => { c.destroy(); resolve(true); });
    });
    if (live) throw fault('PROFILE_IN_USE', 'Another Chrome profile is connected. Disconnect it first.');
    await unlink(p.socket);
  } catch (e) { if (e.code !== 'ENOENT') throw e; }
  const pending = new Map(); const clients = new Set(); let hello = null; let inode;
  function send(value) { process.stdout.write(frame(value, 1024 * 1024)); }
  function reply(socket, value) { if (!socket.destroyed) socket.write(frame(value)); }
  const server = net.createServer(socket => {
    clients.add(socket); const decoder = new FrameDecoder(1024 * 1024);
    socket.pipe(decoder); socket.on('error', () => {}); decoder.on('error', () => socket.destroy());
    socket.on('close', () => {
      clients.delete(socket);
      for (const [id, item] of pending) if (item.socket === socket) {
        clearTimeout(item.timer); pending.delete(id);
        try { send({ type: 'cancel', id }); } catch {}
      }
    });
    decoder.on('data', message => {
      try {
        validateRequest(message);
        if (!hello) throw fault('NOT_READY', 'Chrome extension handshake is not complete');
        if (pending.size >= 64) throw fault('BUSY', 'Too many pending requests');
        const id = randomUUID();
        const timer = setTimeout(() => {
          pending.delete(id);
          try { send({ type: 'cancel', id }); } catch {}
          reply(socket, { id: message.id, error: { code: 'TIMEOUT', message: 'Action outcome is unknown. Inspect before retrying.' } });
        }, 18_000);
        pending.set(id, { socket, id: message.id, timer });
        try { send({ type: 'request', ...message, id, deadline: Date.now() + 16_000 }); }
        catch (e) { clearTimeout(timer); pending.delete(id); throw e; }
      } catch (e) { reply(socket, { id: message?.id, error: errorData(e) }); }
    });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(p.socket, resolve); });
  await chmod(p.socket, 0o600); inode = (await lstat(p.socket)).ino;
  const input = new FrameDecoder(); process.stdin.pipe(input);
  input.on('data', message => {
    if (message.type === 'hello') {
      if (message.protocol !== PROTOCOL || message.extensionId !== config.extensionId) { process.stderr.write('Incompatible extension handshake\n'); shutdown(1); return; }
      hello = message; send({ type: 'welcome', protocol: PROTOCOL, version: VERSION }); return;
    }
    const item = pending.get(message.id); if (!item) return;
    clearTimeout(item.timer); pending.delete(message.id);
    try { reply(item.socket, { id: item.id, ...(message.error ? { error: message.error } : { result: message.result }) }); }
    catch { item.socket.destroy(); }
  });
  let stopping = false;
  async function shutdown(code = 0) {
    if (stopping) return; stopping = true;
    for (const item of pending.values()) { clearTimeout(item.timer); item.socket.destroy(); }
    for (const socket of clients) socket.destroy();
    server.close();
    try { if ((await lstat(p.socket)).ino === inode) await unlink(p.socket); } catch {}
    process.exit(code);
  }
  input.on('error', () => shutdown(1)); process.stdin.on('end', () => shutdown());
  process.stdout.on('error', () => shutdown(1)); process.on('SIGTERM', () => shutdown()); process.on('SIGINT', () => shutdown());
}
