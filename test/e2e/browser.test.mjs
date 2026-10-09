import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { spawn, execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { setup } from '../../lib/setup.mjs';
import { request } from '../../lib/client.mjs';
import { frame } from '../../lib/protocol.mjs';

const fixture = `<!doctype html><html lang="en"><head><title>TabBridge test desk</title></head><body>
<h1>Test desk</h1><label>Name <input id="name" aria-label="Name"></label>
<label>Secret <input type="password" value="never-export-this-password" aria-label="Secret"></label>
<label>Plan <select aria-label="Plan" id="plan"><option value="basic">Basic</option><option value="pro">Pro</option></select></label>
<button id="save">Save</button><button id="alert">Show dialog</button><button disabled>Disabled</button>
<p id="result" role="status">Ready</p><a href="/next">Next page</a>
<script>document.querySelector('#save').onclick=()=>{window.saves=(window.saves||0)+1;document.querySelector('#result').textContent='Saved '+document.querySelector('#name').value+' '+document.querySelector('#plan').value};document.querySelector('#alert').onclick=()=>alert('TabBridge test alert');</script></body></html>`;

test('real extension + native host + CLI/MCP transport end to end', { timeout: 120_000 }, async t => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'tb-e2e-'));
  const profile = path.join(temporary, 'profile'); await mkdir(profile);
  const previousHome = process.env.TABBRIDGE_HOME;
  process.env.TABBRIDGE_HOME = path.join(temporary, 'bridge');
  const installed = await setup({ manifestDir: path.join(profile, 'NativeMessagingHosts') });
  const server = http.createServer((req, res) => { res.setHeader('Content-Type', 'text/html'); res.end(req.url === '/next' ? '<!doctype html><title>Next</title><h1>Next page</h1>' : fixture); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;
  let context;
  const call = (method, params = {}, session = 'e2e') => request(method, params, { session, timeout: 20_000 });
  const refFor = (snapshot, role, label) => {
    const line = snapshot.text.split('\n').find(line => line.includes(`${role} "${label}"`));
    assert.ok(line, `Missing ${role} ${label} in ${snapshot.text}`);
    return line.match(/^\[([^\]]+)\]/)[1];
  };
  try {
    context = await chromium.launchPersistentContext(profile, {
      ...(process.env.TABBRIDGE_TEST_CHROME ? { executablePath: process.env.TABBRIDGE_TEST_CHROME } : { channel: 'chromium' }),
      headless: process.env.TABBRIDGE_TEST_HEADED !== '1',
      args: [`--disable-extensions-except=${path.resolve('extension')}`, `--load-extension=${path.resolve('extension')}`],
      viewport: { width: 1000, height: 800 }
    });
    const popup = await context.newPage(); await popup.goto(`chrome-extension://${installed.extensionId}/popup.html`);
    await popup.getByRole('button', { name: 'Connect', exact: true }).click();
    await t.test('native messaging handshake', async () => {
      await popup.getByRole('button', { name: 'Refresh', exact: true }).click();
      let last;
      for (let i = 0; i < 30; i++) {
        try { last = await call('status'); if (last.connected) break; } catch (e) { last = e; }
        await new Promise(r => setTimeout(r, 100));
      }
      assert.equal(last.connected, true, JSON.stringify(last));
    });
    if (t.signal.aborted) return;
    const userPage = await context.newPage(); await userPage.goto(url);
    await t.test('ungranted browser state stays private', async () => {
      assert.deepEqual((await call('tabs')).tabs, []);
      await assert.rejects(call('open', { url }), { code: 'NEW_TABS_DISABLED' });
    });
    await popup.getByRole('button', { name: 'Refresh', exact: true }).click();
    await popup.getByRole('button', { name: 'Share TabBridge test desk', exact: true }).click();
    const shared = (await call('tabs')).tabs[0]; assert.ok(shared);
    await t.test('claim and session isolation', async () => {
      await call('claim', { tabId: shared.tabId });
      await assert.rejects(call('claim', { tabId: shared.tabId }, 'other'), { code: 'SESSION_CONFLICT' });
      await assert.rejects(call('snapshot', { tabId: shared.tabId }, 'other'), { code: 'SESSION_CONFLICT' });
      await assert.rejects(call('close', { tabId: shared.tabId }), { code: 'USER_TAB' });
      await assert.rejects(call('navigate', { tabId: shared.tabId, url: 'https://example.com' }), { code: 'ORIGIN_CHANGED' });
    });
    const tabId = shared.tabId;
    let state = await call('snapshot', { tabId });
    await t.test('snapshot is readable and does not export password values', async () => {
      assert.match(state.text, /Test desk/);
      assert.doesNotMatch(JSON.stringify(state), /never-export-this-password/);
    });
    await t.test('batch fills, selects, clicks exactly once and reads back', async () => {
      const result = await call('batch', { tabId, steps: [
        { method: 'fill', params: { ref: refFor(state, 'textbox', 'Name'), text: 'Ada' } },
        { method: 'select', params: { ref: refFor(state, 'combobox', 'Plan'), value: 'pro' } },
        { method: 'click', params: { ref: refFor(state, 'button', 'Save') } },
        { method: 'wait', params: { text: 'Saved Ada pro' } }
      ] });
      assert.equal(result.completed, 4, JSON.stringify(result)); assert.match(result.snapshot.text, /Saved Ada pro/);
      assert.equal(await userPage.evaluate(() => window.saves), 1);
      await assert.rejects(call('click', { tabId, ref: refFor(state, 'button', 'Save') }), { code: 'STALE_REF' });
    });
    await t.test('developer evaluation is opt-in and grants can be revoked', async () => {
      await assert.rejects(call('evaluate', { tabId, expression: 'document.title' }), { code: 'DEVELOPER_DISABLED' });
      await popup.getByRole('checkbox', { name: /JavaScript evaluation/ }).check();
      assert.equal((await call('evaluate', { tabId, expression: 'document.title' })).value, 'TabBridge test desk');
      await popup.getByRole('checkbox', { name: /JavaScript evaluation/ }).uncheck();
    });
    await t.test('screenshot is a real PNG', async () => {
      const png = await call('screenshot', { tabId });
      assert.equal(Buffer.from(png.data, 'base64').subarray(1, 4).toString(), 'PNG');
      await mkdir('artifacts', { recursive: true }); await writeFile('artifacts/browser-test.png', Buffer.from(png.data, 'base64'));
    });
    await t.test('MCP SDK receives live page text and image content', async () => {
      const client = new Client({ name: 'e2e-mcp', version: '1.0.0' });
      try {
        await client.connect(new StdioClientTransport({ command: process.execPath, args: ['bin/tabbridge.mjs', 'mcp', '--session', 'e2e'], env: { PATH: process.env.PATH, TABBRIDGE_HOME: process.env.TABBRIDGE_HOME } }));
        const text = await client.callTool({ name: 'browser_snapshot', arguments: { tabId } });
        assert.match(text.content[0].text, /Saved Ada pro/); assert.notEqual(text.isError, true);
        const image = await client.callTool({ name: 'browser_screenshot', arguments: { tabId } });
        assert.equal(image.content[0].type, 'image'); assert.equal(image.content[0].mimeType, 'image/png');
      } finally { await client.close(); }
    });
    await t.test('partial batches stop without repeating prior writes', async () => {
      const fresh = await call('snapshot', { tabId });
      const result = await call('batch', { tabId, steps: [
        { method: 'click', params: { ref: refFor(fresh, 'button', 'Save') } },
        { method: 'click', params: { ref: refFor(fresh, 'button', 'Disabled') } },
        { method: 'click', params: { ref: refFor(fresh, 'button', 'Save') } }
      ] });
      assert.equal(result.completed, 1); assert.ok(result.failed);
      assert.equal(await userPage.evaluate(() => window.saves), 2);
      const diff = await call('snapshot', { tabId, diff: true });
      assert.ok(diff.changes); assert.ok(diff.refs.length);
    });
    await t.test('CLI process reads the same session', async () => {
      const result = await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ['bin/tabbridge.mjs', 'tabs', '--session', 'e2e'], { env: process.env });
        let stdout = ''; let stderr = ''; child.stdout.on('data', b => stdout += b); child.stderr.on('data', b => stderr += b);
        child.on('close', code => code ? reject(new Error(stderr)) : resolve(JSON.parse(stdout)));
      });
      assert.equal(result.tabs[0].tabId, tabId);
    });
    await t.test('disconnected clients cannot leave queued clicks behind', async () => {
      const fresh = await call('snapshot', { tabId });
      const blocker = call('wait', { tabId, text: 'this text will never appear', timeoutMs: 1500 });
      const blockerDone = assert.rejects(blocker, { code: 'WAIT_TIMEOUT' });
      await new Promise(r => setTimeout(r, 150));
      const socket = net.createConnection(path.join(process.env.TABBRIDGE_HOME, 'bridge.sock'));
      await new Promise((resolve, reject) => { socket.on('connect', resolve); socket.on('error', reject); });
      socket.write(frame({ id: 'cancelled-click', method: 'click', params: { tabId, ref: refFor(fresh, 'button', 'Save') }, session: 'e2e' }));
      await new Promise(r => setTimeout(r, 100)); socket.destroy();
      await blockerDone;
      // A new snapshot also waits behind any incorrectly retained click in the tab queue.
      await call('snapshot', { tabId });
      assert.equal(await userPage.evaluate(() => window.saves), 2);
    });
    await t.test('origin change revokes a user tab grant', async () => {
      await userPage.goto(url.replace('127.0.0.1', 'localhost'));
      await assert.rejects(call('snapshot', { tabId }), e => ['TAB_NOT_GRANTED', 'ORIGIN_CHANGED'].includes(e.code));
    });
    await t.test('agent-created tabs are isolated and can be closed', async () => {
      await popup.getByRole('checkbox', { name: /Agent-created tabs/ }).check();
      const own = await call('open', { url });
      await call('wait', { tabId: own.tabId, text: 'Test desk' });
      await assert.rejects(call('snapshot', { tabId: own.tabId }, 'other'), { code: 'SESSION_CONFLICT' });
      await call('close', { tabId: own.tabId });
    });
    await t.test('native host restart reconnects without a browser restart', async () => {
      // Identify only the host holding this disposable test socket.
      const socket = path.join(process.env.TABBRIDGE_HOME, 'bridge.sock');
      const output = execFileSync('lsof', ['-t', socket], { encoding: 'utf8' }).trim();
      const pids = [...new Set(output.split(/\s+/).map(Number))]; assert.equal(pids.length, 1); process.kill(pids[0], 'SIGTERM');
      let result;
      for (let i = 0; i < 50; i++) { await new Promise(r => setTimeout(r, 100)); try { result = await call('status'); if (result.connected) break; } catch {} }
      assert.equal(result?.connected, true);
    });
    await popup.getByRole('button', { name: 'Refresh', exact: true }).click();
    await popup.locator('body').screenshot({ path: 'artifacts/extension-popup.png' });
    await t.test('stop disconnects and revokes everything', async () => {
      await popup.getByRole('button', { name: 'Stop & revoke all', exact: true }).click();
      await assert.rejects(call('status'), e => ['NOT_CONNECTED', 'DISCONNECTED'].includes(e.code));
    });
  } finally {
    await context?.close(); await new Promise(resolve => server.close(resolve));
    if (previousHome === undefined) delete process.env.TABBRIDGE_HOME; else process.env.TABBRIDGE_HOME = previousHome;
    await rm(temporary, { recursive: true, force: true });
  }
});
