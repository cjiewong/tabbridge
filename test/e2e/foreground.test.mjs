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

const fixture = `<!doctype html><title>Foreground dialog fixture</title>
<nav>Fixture navigation</nav><footer>Fixture footer</footer>
<div id="overlay" style="position:fixed;inset:0;background:#eee"><div id="content" role="dialog" aria-label="Foreground dialog" hidden><h1>Dialog ready</h1><table><caption>Ad groups ready</caption><tr><th>Group</th><th>State</th></tr><tr><td>Fixture campaign</td><td>Ready</td></tr></table><button>Continue fixture</button></div></div>
<script>
let pending=false;
function render(){
 const visible=document.visibilityState==='visible'&&document.hasFocus();
 if(!visible){document.querySelector('#content').hidden=true;return}
 if(!pending&&document.querySelector('#content').hidden){pending=true;setTimeout(()=>{
  if(document.visibilityState==='visible'&&document.hasFocus()){document.querySelector('#content').hidden=false;window.foregroundRenders=(window.foregroundRenders||0)+1}
  pending=false;
 },200)}
}
document.addEventListener('visibilitychange',render);window.addEventListener('focus',render);window.addEventListener('blur',render);render();
</script>`;

test('activation reveals a real background dialog without focus emulation', { timeout: 60000 }, async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'tb-fg-'));
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
    await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'ui.settings', quiet: false }));
    await popup.evaluate(() => chrome.storage.local.set({ uiLanguage: 'en' }));
    await popup.reload();
    await popup.getByRole('button', { name: 'Connect', exact: true }).click();
    const call = (method, params = {}) => request(method, params, { session: 'foreground-fixture' });
    for (let attempt = 0; attempt < 50; attempt++) {
      try { if ((await call('status')).connected) break; } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    // Create the page in the background using Chrome itself, without another
    // debugger session overriding its focus state.
    const target = await popup.evaluate(url => chrome.tabs.create({ url, active: false }), url);
    await popup.evaluate(tabId => chrome.runtime.sendMessage({ type: 'ui.grant', tabId }), target.id);
    await call('claim', { tabId: target.id });
    let background;
    for (let attempt = 0; attempt < 50; attempt++) {
      background = await call('snapshot', { tabId: target.id });
      if (background.title === 'Foreground dialog fixture') break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(background.active, false);
    assert.doesNotMatch(background.text, /Dialog ready|Ad groups ready/);
    assert.equal(background.readyState, 'complete');
    assert.equal(background.domContentLoaded, true);
    assert.equal(background.visibilityState, 'hidden');
    assert.equal(background.documentFocused, false);
    assert.match(background.renderHint, /Background/);
    await assert.rejects(call('wait', { tabId: target.id, text: 'Ad groups ready', timeoutMs: 100 }), error => error.code === 'WAIT_TIMEOUT' && /background tab/.test(error.message));
    const before = await context.pages().find(page => page.url() === url).evaluate(() => ({ visibility: document.visibilityState, focused: document.hasFocus() }));
    assert.equal(before.visibility, 'hidden');
    assert.equal(before.focused, false);
    const client = new Client({ name: 'foreground-readiness', version: '1.0.0' });
    let activated;
    try {
      await client.connect(new StdioClientTransport({ command: process.execPath, args: ['bin/tabbridge.mjs', 'mcp', '--session', 'foreground-fixture'], env: { PATH: process.env.PATH, TABBRIDGE_HOME: process.env.TABBRIDGE_HOME } }));
      const result = await client.callTool({ name: 'browser_activate', arguments: { tabId: target.id, waitForText: 'Ad groups ready', timeoutMs: 3000 } });
      assert.notEqual(result.isError, true, JSON.stringify(result));
      activated = JSON.parse(result.content[0].text);
    } finally { await client.close(); }
    assert.equal(activated.active, true);
    assert.equal(activated.windowFocused, true);
    assert.equal(activated.wait.found, true);
    assert.equal(activated.wait.visibilityState, 'visible');
    assert.equal(activated.wait.documentFocused, true);
    await call('wait', { tabId: target.id, text: 'Dialog ready' });
    const visible = await call('snapshot', { tabId: target.id });
    assert.equal(visible.active, true);
    assert.equal(visible.windowFocused, true);
    assert.match(visible.text, /Dialog ready/);
    assert.match(visible.text, /Ad groups ready|Fixture campaign/);
    assert.equal(visible.visibilityState, 'visible');
    assert.equal(visible.documentFocused, true);
    const page = context.pages().find(page => page.url() === url);
    assert.equal(await page.evaluate(() => window.foregroundRenders), 1);
    assert.deepEqual(await page.evaluate(() => ({ visibility: document.visibilityState, focused: document.hasFocus() })), { visibility: 'visible', focused: true });
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
