import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { chromium } from 'playwright';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { setup } from '../../lib/setup.mjs';
import { request } from '../../lib/client.mjs';

const fixture = `<!doctype html><meta charset="utf-8"><title>Capability fixture</title><style>
body{margin:20px;font:16px sans-serif}.row{display:flex;gap:30px;margin:12px 0}.box{padding:20px;background:#ddd;width:160px}.menu{display:none}#hover-area:hover .menu{display:block}#long{height:1200px;background:linear-gradient(#eee,#9cb)}
</style><h1>Capability desk</h1><p id="article">Readable article text with punctuation &amp; Unicode 中文.</p><p hidden>fixture-hidden-text</p>
<label>Name <input aria-label="Name" value="Original"></label><input type="password" aria-label="Secret" value="fixture-password">
<div id="hover-area"><button aria-label="Hover menu">Hover menu</button><div class="menu"><button id="menu-item">Menu action</button></div></div>
<div class="row"><div class="box" id="card" role="button" aria-label="Drag card" draggable="true">Card</div><div class="box" id="drop" role="button" aria-label="Drop target">Drop here</div></div>
<div class="row"><div class="box" id="pointer" role="button" aria-label="Pointer source">Pointer drag</div><div class="box" id="pointer-target" role="button" aria-label="Pointer target">Target</div></div>
<label>Upload fixture <input type="file" multiple aria-label="Upload fixture" id="files"></label>
<p role="status" id="result">Ready</p><div id="long"></div><h2>End of long page</h2>
<script>
document.querySelector('#menu-item').onclick=()=>{document.querySelector('#result').textContent='Menu clicked'};
document.querySelector('#card').ondragstart=event=>event.dataTransfer.setData('text/plain','fixture-card');
document.querySelector('#drop').ondragover=event=>event.preventDefault();
document.querySelector('#drop').ondrop=event=>{event.preventDefault();window.drops=(window.drops||0)+1;document.querySelector('#result').textContent='Dropped '+event.dataTransfer.getData('text/plain')};
let pointerDrag=false;document.querySelector('#pointer').onpointerdown=()=>pointerDrag=true;
document.querySelector('#pointer-target').onpointerup=()=>{if(pointerDrag){window.pointerDrops=(window.pointerDrops||0)+1;document.querySelector('#result').textContent='Pointer dropped'}pointerDrag=false};
document.querySelector('#files').onchange=async event=>{window.fileChanges=(window.fileChanges||0)+1;window.fileContents=await Promise.all([...event.target.files].map(file=>file.text()));document.querySelector('#result').textContent='Files selected '+event.target.files.length};
</script>`;

test('expanded tools operate on local fixtures with authorization and bounded output', { timeout: 120000 }, async t => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'tb-cap-'));
  const profile = path.join(temporary, 'profile'); await mkdir(profile);
  const previousHome = process.env.TABBRIDGE_HOME;
  process.env.TABBRIDGE_HOME = path.join(temporary, 'bridge');
  const server = http.createServer((req, response) => {
    if (req.url.startsWith('/api/disconnect')) { req.socket.destroy(); return; }
    if (req.url.startsWith('/api/')) {
      response.statusCode = req.url.startsWith('/api/fail') ? 500 : 200;
      response.setHeader('Content-Type', 'application/json'); response.setHeader('Set-Cookie', 'fixture-cookie=fixture-cookie-secret');
      response.end('{"value":"fixture-response-body"}'); return;
    }
    response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(fixture);
  });
  let context;
  const call = (method, params = {}, session = 'capabilities') => request(method, params, { session });
  const refFor = (state, role, label) => {
    const line = state.text.split('\n').find(line => line.includes(`${role} "${label}"`));
    assert.ok(line, `Missing ${role} ${label}`); return line.match(/^\[([^\]]+)\]/)[1];
  };
  try {
    const installed = await setup({ manifestDir: path.join(profile, 'NativeMessagingHosts') });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${server.address().port}/`;
    context = await chromium.launchPersistentContext(profile, {
      ...(process.env.TABBRIDGE_TEST_CHROME ? { executablePath: process.env.TABBRIDGE_TEST_CHROME } : { channel: 'chromium' }),
      headless: process.env.TABBRIDGE_TEST_HEADED !== '1', chromiumSandbox: true,
      args: [`--disable-extensions-except=${path.resolve('extension')}`, `--load-extension=${path.resolve('extension')}`],
      viewport: { width: 1000, height: 800 }
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    await worker.evaluate(() => chrome.storage.local.set({ uiLanguage: 'en' }));
    const popup = await context.newPage(); await popup.goto(`chrome-extension://${installed.extensionId}/popup.html`);
    await popup.getByRole('button', { name: 'Connect', exact: true }).click();
    for (let attempt = 0; attempt < 50; attempt++) {
      try { if ((await call('status')).connected) break; } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const page = await context.newPage(); await page.goto(url);
    const tabId = await popup.evaluate(async url => {
      const tab = (await chrome.tabs.query({})).find(tab => tab.url === url);
      await chrome.runtime.sendMessage({ type: 'ui.grant', tabId: tab.id }); return tab.id;
    }, url);
    await call('claim', { tabId });

    await t.test('rendered text is bounded and excludes hidden text and input passwords', async () => {
      const text = await call('read', { tabId });
      assert.match(text.text, /Readable article text.*中文/);
      assert.doesNotMatch(text.text, /fixture-hidden-text|fixture-password|Original/);
      assert.equal(text.truncated, false);
      const limited = await call('read', { tabId, maxChars: 10 });
      assert.equal(limited.text.length, 10); assert.equal(limited.truncated, true);
      await assert.rejects(call('read', { tabId }, 'other'), { code: 'SESSION_CONFLICT' });
    });
    await t.test('hover reveals a menu and uses fresh references for the next action', async () => {
      const state = await call('snapshot', { tabId });
      const menu = refFor(state, 'button', 'Hover menu');
      assert.doesNotMatch(state.text, /Menu action/);
      const result = await call('batch', { tabId, steps: [{ method: 'hover', params: { ref: menu } }] });
      assert.match(result.snapshot.text, /Menu action/);
      await call('click', { tabId, ref: refFor(result.snapshot, 'button', 'Menu action') });
      assert.equal(await page.locator('#result').textContent(), 'Menu clicked');
      await assert.rejects(call('hover', { tabId, ref: menu }), { code: 'STALE_REF' });
    });
    await t.test('modifier shortcuts act on the focused field without inserting modifier text', async () => {
      const state = await call('snapshot', { tabId });
      await call('click', { tabId, ref: refFor(state, 'textbox', 'Name') });
      await call('press', { tabId, key: process.platform === 'darwin' ? 'Meta+A' : 'Control+A' });
      await call('press', { tabId, key: 'Backspace' });
      assert.equal(await page.locator('input[aria-label="Name"]').inputValue(), '');
      await call('press', { tabId, key: 'Shift+A' });
      assert.equal(await page.locator('input[aria-label="Name"]').inputValue(), 'A');
      await assert.rejects(call('press', { tabId, key: 'Control+Ctrl+A' }), { code: 'INVALID_PARAMS' });
      await assert.rejects(call('press', { tabId, key: 'toString' }), { code: 'INVALID_PARAMS' });
      assert.equal(await page.locator('input[aria-label="Name"]').inputValue(), 'A');
    });
    await t.test('HTML5 and pointer drags deliver a single drop', async () => {
      let state = await call('snapshot', { tabId });
      const result = await call('drag', { tabId, sourceRef: refFor(state, 'button', 'Drag card'), targetRef: refFor(state, 'button', 'Drop target') });
      assert.equal(result.kind, 'html5'); assert.equal(await page.evaluate(() => window.drops), 1);
      assert.equal(await page.locator('#result').textContent(), 'Dropped fixture-card');
      state = await call('snapshot', { tabId });
      const pointer = await call('drag', { tabId, sourceRef: refFor(state, 'button', 'Pointer source'), targetRef: refFor(state, 'button', 'Pointer target') });
      assert.equal(pointer.kind, 'pointer'); assert.equal(await page.evaluate(() => window.pointerDrops), 1);
    });
    await t.test('local upload selects actual bytes exactly once and rejects invalid files', async () => {
      const first = path.join(temporary, 'first.txt'); const second = path.join(temporary, 'second.txt');
      await writeFile(first, 'fixture first file 中文'); await writeFile(second, 'fixture second file');
      const state = await call('snapshot', { tabId }); const ref = refFor(state, 'button', 'Upload fixture');
      assert.deepEqual(await call('upload', { tabId, ref, files: [first, second] }), { selectedFiles: 2 });
      await page.waitForFunction(() => window.fileContents?.length === 2);
      assert.deepEqual(await page.evaluate(() => window.fileContents), ['fixture first file 中文', 'fixture second file']);
      assert.equal(await page.evaluate(() => window.fileChanges), 1);
      await assert.rejects(call('upload', { tabId, ref, files: [temporary] }), { code: 'INVALID_FILE' });
      await assert.rejects(call('upload', { tabId, ref, files: [path.join(temporary, 'missing')] }), { code: 'INVALID_FILE' });
      await assert.rejects(call('upload', { tabId, ref, files: ['relative.txt'] }), { code: 'INVALID_PARAMS' });
      assert.equal(await page.evaluate(() => window.fileChanges), 1);
      await call('upload', { tabId, ref, files: [] });
      assert.equal(await page.locator('#files').evaluate(element => element.files.length), 0);
    });
    await t.test('full-page and element screenshots have the expected PNG dimensions', async () => {
      const size = result => { const png = Buffer.from(result.data, 'base64'); assert.equal(png.subarray(1, 4).toString(), 'PNG'); return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) }; };
      const viewport = size(await call('screenshot', { tabId }));
      const actualViewport = await popup.evaluate(tabId => chrome.tabs.get(tabId).then(tab => ({ width: tab.width, height: tab.height })), tabId);
      assert.deepEqual(viewport, actualViewport);
      const full = size(await call('screenshot', { tabId, fullPage: true }));
      assert.ok(full.height > viewport.height); assert.equal(full.width, viewport.width);
      const state = await call('snapshot', { tabId }); const ref = refFor(state, 'heading', 'Capability desk');
      const cropped = size(await call('screenshot', { tabId, ref }));
      assert.ok(cropped.height < 100); assert.ok(cropped.width < viewport.width);
      await assert.rejects(call('screenshot', { tabId, ref, fullPage: true }), { code: 'INVALID_PARAMS' });
    });
    await t.test('network capture is explicit, redacted, bounded and cleared on release', async () => {
      assert.deepEqual((await call('network', { tabId })).requests, []);
      await call('network', { tabId, action: 'start' });
      await page.evaluate(async () => {
        await fetch('/api/ok?token=fixture-query-secret', { method: 'POST', body: 'fixture-request-secret', headers: { 'X-Secret': 'fixture-header-secret' } }).then(response => response.text());
        await fetch('/api/fail').then(response => response.text());
        await fetch('/api/disconnect').catch(() => {});
      });
      let captured;
      for (let attempt = 0; attempt < 50; attempt++) {
        captured = await call('network', { tabId });
        if (captured.requests.some(record => record.failed)) break;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      const ok = captured.requests.find(record => record.url.endsWith('/api/ok'));
      assert.equal(ok.status, 200); assert.equal(ok.method, 'POST'); assert.equal(ok.queryRedacted, true);
      assert.equal(captured.requests.find(record => record.url.endsWith('/api/fail')).status, 500);
      assert.ok(captured.requests.some(record => record.failed));
      assert.doesNotMatch(JSON.stringify(captured), /fixture-query-secret|fixture-header-secret|fixture-request-secret|fixture-response-body|fixture-cookie-secret/);
      await assert.rejects(call('network', { tabId }, 'other'), { code: 'SESSION_CONFLICT' });
      await page.evaluate(() => Promise.all(Array.from({ length: 110 }, (_, i) => fetch('/api/limit/' + i).then(response => response.text()))));
      const bounded = await call('network', { tabId }); assert.equal(bounded.requests.length, 100);
      await call('network', { tabId, action: 'stop' });
      await page.evaluate(() => fetch('/api/after-stop').then(response => response.text()));
      assert.ok(!(await call('network', { tabId })).requests.some(record => record.url.endsWith('/api/after-stop')));
      await call('release', { tabId }); await call('claim', { tabId });
      assert.deepEqual(await call('network', { tabId }), { recording: false, limit: 100, requests: [] });
    });
    await t.test('MCP delivers new text and screenshot capabilities through the public tool schemas', async () => {
      const client = new Client({ name: 'capabilities-mcp', version: '1' });
      try {
        await client.connect(new StdioClientTransport({ command: process.execPath, args: ['bin/tabbridge.mjs', 'mcp', '--session', 'capabilities'], env: { PATH: process.env.PATH, TABBRIDGE_HOME: process.env.TABBRIDGE_HOME } }));
        const result = await client.callTool({ name: 'browser_read', arguments: { tabId, maxChars: 100 } });
        assert.notEqual(result.isError, true); assert.equal(JSON.parse(result.content[0].text).truncated, true);
        const image = await client.callTool({ name: 'browser_screenshot', arguments: { tabId, fullPage: true } });
        assert.notEqual(image.isError, true); assert.equal(image.content[0].type, 'image');
      } finally { await client.close(); }
    });
    await t.test('revoking access during attachment prevents a late debugger attachment and capture', async () => {
      const revocationPage = await context.newPage(); await revocationPage.goto(url + 'revocation');
      const target = await popup.evaluate(async url => {
        const tab = (await chrome.tabs.query({})).find(tab => tab.url === url);
        await chrome.runtime.sendMessage({ type: 'ui.grant', tabId: tab.id }); return tab.id;
      }, url + 'revocation');
      await call('claim', { tabId: target });
      const worker = context.serviceWorkers().find(worker => worker.url().startsWith(`chrome-extension://${installed.extensionId}/`));
      assert.ok(worker);
      await worker.evaluate(tabId => {
        const original = chrome.debugger.attach.bind(chrome.debugger);
        globalThis.restoreAttach = () => { chrome.debugger.attach = original; delete globalThis.releaseAttach; };
        chrome.debugger.attach = async (...args) => {
          if (args[0].tabId === tabId) await new Promise(resolve => { globalThis.releaseAttach = resolve; });
          return original(...args);
        };
      }, target);
      try {
        const pending = call('network', { tabId: target, action: 'start' });
        const denied = assert.rejects(pending, { code: 'CANCELLED' });
        for (let attempt = 0; attempt < 50; attempt++) {
          if (await worker.evaluate(() => typeof globalThis.releaseAttach === 'function')) break;
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        assert.equal(await worker.evaluate(() => typeof globalThis.releaseAttach), 'function');
        const revoked = await popup.evaluate(tabId => chrome.runtime.sendMessage({ type: 'ui.revoke', tabId }), target);
        assert.equal(revoked.ok, true);
        await worker.evaluate(() => globalThis.releaseAttach());
        await denied;
        const stillAttached = await popup.evaluate(async tabId => {
          try { await chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', { expression: '1', returnByValue: true }); return true; }
          catch { return false; }
        }, target);
        assert.equal(stillAttached, false);
        await assert.rejects(call('network', { tabId: target }), { code: 'TAB_NOT_GRANTED' });
      } finally {
        await worker.evaluate(() => { if (globalThis.releaseAttach) globalThis.releaseAttach(); globalThis.restoreAttach(); });
        await revocationPage.close();
      }
    });
  } finally {
    await context?.close(); await new Promise(resolve => server.close(resolve));
    if (previousHome === undefined) delete process.env.TABBRIDGE_HOME; else process.env.TABBRIDGE_HOME = previousHome;
    await rm(temporary, { recursive: true, force: true });
  }
});
