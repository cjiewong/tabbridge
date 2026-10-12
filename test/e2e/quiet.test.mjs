import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { chromium } from 'playwright';
import { setup } from '../../lib/setup.mjs';
import { request } from '../../lib/client.mjs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const fixture = `<!doctype html><title>Quiet fixture</title><h1>Background workspace</h1>
<label>Name <input aria-label="Name"></label><button id="save">Save</button><p id="result">Unsaved</p>
<div id="content" hidden><table><caption>Background table ready</caption><tr><td>Fixture row</td></tr></table></div>
<div style="height:1500px"></div><p>End of page</p>
<script>
let renders=0;
function render(){const visible=document.visibilityState==='visible'&&document.hasFocus();document.getElementById('content').hidden=!visible;if(visible)renders++}
document.addEventListener('visibilitychange',render);window.addEventListener('focus',render);window.addEventListener('blur',render);setInterval(render,100);render();
document.getElementById('save').onclick=()=>{window.saves=(window.saves||0)+1;document.getElementById('result').textContent='Saved '+document.querySelector('input').value};
</script>`;

test('quiet policy and optional focus emulation keep the real browser selection unchanged', { timeout: 90000 }, async t => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'tb-quiet-'));
  const profile = path.join(temporary, 'profile'); await mkdir(profile);
  const previousHome = process.env.TABBRIDGE_HOME;
  process.env.TABBRIDGE_HOME = path.join(temporary, 'bridge');
  const server = http.createServer((_req, response) => { response.setHeader('Content-Type', 'text/html'); response.end(fixture); });
  let processChrome; let browser; let stderr = ''; let launchError;
  try {
    const installed = await setup({ manifestDir: path.join(profile, 'NativeMessagingHosts') });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${server.address().port}/`;
    // Own a disposable browser process. Connecting with noDefaults prevents
    // Playwright's usual focus emulation from masking visibility/focus failures.
    processChrome = spawn(process.env.TABBRIDGE_TEST_CHROME || chromium.executablePath(), [
      `--user-data-dir=${profile}`, '--remote-debugging-port=0',
      `--disable-extensions-except=${path.resolve('extension')}`, `--load-extension=${path.resolve('extension')}`,
      '--no-first-run', '--no-default-browser-check',
      ...(process.env.TABBRIDGE_TEST_HEADED === '1' ? [] : ['--headless=new']), 'about:blank'
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    processChrome.on('error', error => { launchError = error; });
    processChrome.stderr.on('data', data => { stderr = (stderr + data).slice(-8000); });
    let endpoint;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (launchError) throw launchError;
      if (processChrome.exitCode !== null || processChrome.signalCode !== null) throw new Error(`Disposable Chrome exited: ${stderr}`);
      try {
        const [port, target] = (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).trim().split('\n');
        endpoint = `ws://127.0.0.1:${port}${target}`; break;
      } catch { await new Promise(resolve => setTimeout(resolve, 100)); }
    }
    assert.ok(endpoint, `Disposable Chrome did not start: ${stderr}`);
    browser = await chromium.connectOverCDP(endpoint, { noDefaults: true });
    const context = browser.contexts()[0];
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${installed.extensionId}/popup.html`);
    await popup.evaluate(() => chrome.storage.local.set({ uiLanguage: 'en' }));
    await popup.reload();
    await popup.getByRole('button', { name: 'Connect', exact: true }).click();
    const call = async (method, params = {}) => { try { return await request(method, params, { session: 'quiet-fixture' }); } catch (error) { error.message = `${method}: ${error.message}`; throw error; } };
    for (let attempt = 0; attempt < 50; attempt++) {
      try { if ((await call('status')).connected) break; } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const status = await call('status');
    assert.equal(status.quiet, true); assert.equal(status.focusEmulation, false);
    await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'ui.settings', allowNewTabs: true, developer: true }));
    const target = await call('open', { url });
    const tabId = target.tabId;
    // Put automation in a separate unfocused window, with another selected
    // tab. The driver stays in the original window; no focus emulation is
    // supplied by Playwright (connectOverCDP noDefaults above).
    const backgroundWindow = await popup.evaluate(async tabId => {
      const window = await chrome.windows.create({ url: 'about:blank', focused: false });
      await chrome.tabs.move(tabId, { windowId: window.id, index: 1 });
      await chrome.tabs.update(window.tabs[0].id, { active: true });
      return window.id;
    }, tabId);
    const originalSelection = await popup.evaluate(() => chrome.tabs.query({ active: true }).then(tabs => tabs.map(tab => ({ id: tab.id, windowId: tab.windowId }))));
    const originalWindow = await popup.evaluate(() => chrome.windows.getLastFocused().then(window => ({ id: window.id, focused: window.focused })));
    const sameSelection = async () => {
      assert.deepEqual(await popup.evaluate(() => chrome.tabs.query({ active: true }).then(tabs => tabs.map(tab => ({ id: tab.id, windowId: tab.windowId })))), originalSelection);
      assert.deepEqual(await popup.evaluate(() => chrome.windows.getLastFocused().then(window => ({ id: window.id, focused: window.focused }))), originalWindow);
      assert.equal((await popup.evaluate(id => chrome.tabs.get(id), tabId)).active, false);
      assert.equal((await popup.evaluate(id => chrome.windows.get(id), backgroundWindow)).focused, false);
    };
    const refFor = (snapshot, role, label) => {
      const line = snapshot.text.split('\n').find(line => line.includes(`${role} "${label}"`));
      assert.ok(line, snapshot.text); return line.match(/^\[([^\]]+)\]/)[1];
    };
    const change = async patch => {
      const result = await popup.evaluate(patch => chrome.runtime.sendMessage({ type: 'ui.settings', ...patch }), patch);
      assert.equal(result.ok, true, JSON.stringify(result));
    };
    await t.test('default policy refuses activation and evaluation through CLI transport and MCP', async () => {
      const background = await call('snapshot', { tabId });
      assert.equal(background.visibilityState, 'hidden');
      assert.equal(background.documentFocused, false);
      assert.equal(background.focusEmulated, false);
      assert.doesNotMatch(background.text, /Background table ready/);
      await assert.rejects(call('activate', { tabId }), { code: 'QUIET_MODE' });
      await assert.rejects(call('evaluate', { tabId, expression: 'window.focus()' }), { code: 'QUIET_MODE' });
      assert.equal((await call('status')).developer, false);
      const client = new Client({ name: 'quiet-test', version: '1.0.0' });
      try {
        await client.connect(new StdioClientTransport({ command: process.execPath, args: ['bin/tabbridge.mjs', 'mcp', '--session', 'quiet-fixture'], env: { PATH: process.env.PATH, TABBRIDGE_HOME: process.env.TABBRIDGE_HOME } }));
        const result = await client.callTool({ name: 'browser_activate', arguments: { tabId, waitForText: 'Background table ready' } });
        assert.equal(result.isError, true); assert.match(result.content[0].text, /QUIET_MODE/);
      } finally { await client.close(); }
      await sameSelection();
      await assert.rejects(call('wait', { tabId, text: 'Background table ready', timeoutMs: 150 }), error => error.code === 'WAIT_TIMEOUT' && /Do not disturb/.test(error.message));
    });
    await t.test('background input, click, scrolling and screenshots do not select the target', async () => {
      let snapshot = await call('snapshot', { tabId });
      await call('fill', { tabId, ref: refFor(snapshot, 'textbox', 'Name'), text: 'Ada' });
      await call('press', { tabId, key: 'End' });
      await call('click', { tabId, ref: refFor(snapshot, 'button', 'Save') });
      await call('wait', { tabId, text: 'Saved Ada' });
      const page = context.pages().find(page => page.url() === url);
      assert.equal(await page.evaluate(() => window.saves), 1);
      const scroll = await call('scroll', { tabId, deltaY: 300 });
      assert.equal(scroll.target, 'document');
      assert.ok(scroll.position.y > 0);
      const screenshot = await call('screenshot', { tabId });
      assert.equal(Buffer.from(screenshot.data, 'base64').subarray(1,4).toString(), 'PNG');
      await sameSelection();
    });
    await t.test('opt-in emulation renders hidden content and reports simulated focus honestly', async () => {
      await change({ focusEmulation: true });
      const ready = await call('wait', { tabId, text: 'Background table ready', timeoutMs: 3000 });
      assert.equal(ready.focusEmulated, true);
      assert.equal(ready.visibilityState, 'visible'); assert.equal(ready.documentFocused, true);
      const snapshot = await call('snapshot', { tabId });
      assert.match(snapshot.text, /Background table ready/);
      assert.equal(snapshot.active, false); assert.equal(snapshot.focusEmulated, true);
      assert.match(snapshot.renderHint, /not evidence/);
      await sameSelection();
      await call('navigate', { tabId, url: url + 'next' });
      assert.equal((await call('wait', { tabId, text: 'Background table ready' })).focusEmulated, true);
      await sameSelection();
    });
    await t.test('disabling emulation, releasing and revoking clear simulated focus', async () => {
      await change({ focusEmulation: false });
      const plain = await call('snapshot', { tabId });
      assert.equal(plain.focusEmulated, false); assert.equal(plain.visibilityState, 'hidden');
      await change({ focusEmulation: true });
      await call('wait', { tabId, text: 'Background table ready' });
      const page = context.pages().find(page => page.url() === url + 'next');
      await call('release', { tabId });
      assert.deepEqual(await page.evaluate(() => ({ visibility: document.visibilityState, focused: document.hasFocus() })), { visibility: 'hidden', focused: false });
      await popup.evaluate(tabId => chrome.runtime.sendMessage({ type: 'ui.grant', tabId }), tabId);
      await call('claim', { tabId }); await call('wait', { tabId, text: 'Background table ready' });
      await popup.evaluate(tabId => chrome.runtime.sendMessage({ type: 'ui.revoke', tabId }), tabId);
      assert.equal(await page.evaluate(() => document.hasFocus()), false);
      await assert.rejects(call('snapshot', { tabId }), { code: 'TAB_NOT_GRANTED' });
      await sameSelection();
    });
    await t.test('quiet preferences persist and only user opt-out allows activation', async () => {
      await popup.reload();
      const stored = await popup.evaluate(() => chrome.storage.local.get('settings'));
      assert.equal(stored.settings.quiet, true); assert.equal(stored.settings.focusEmulation, true);
      await popup.evaluate(tabId => chrome.runtime.sendMessage({ type: 'ui.grant', tabId }), tabId);
      await call('claim', { tabId });
      await change({ quiet: false });
      assert.equal((await call('status')).focusEmulation, false);
      const activated = await call('activate', { tabId, waitForText: 'Background table ready' });
      assert.equal(activated.active, true); assert.equal(activated.wait.focusEmulated, false);
      await change({ quiet: true });
      await assert.rejects(call('close', { tabId }), { code: 'USER_TAB' });
      await change({ allowAllTabs: true });
      await assert.rejects(call('close', { tabId }), { code: 'QUIET_MODE' });
      await call('release', { tabId });
      assert.ok(await popup.evaluate(tabId => chrome.tabs.get(tabId), tabId));
    });
  } finally {
    await browser?.close();
    if (processChrome?.pid && processChrome.exitCode === null && processChrome.signalCode === null) {
      processChrome.kill('SIGTERM');
      await new Promise(resolve => {
        const timeout = setTimeout(() => { processChrome.kill('SIGKILL'); resolve(); }, 5000);
        processChrome.once('exit', () => { clearTimeout(timeout); resolve(); });
      });
    }
    await new Promise(resolve => server.close(resolve));
    if (previousHome === undefined) delete process.env.TABBRIDGE_HOME; else process.env.TABBRIDGE_HOME = previousHome;
    // Chrome's child processes may finish writing the disposable profile just
    // after the parent exits. Retry transient filesystem cleanup races only.
    await rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
