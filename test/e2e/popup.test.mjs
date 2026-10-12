import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { chromium } from 'playwright';
import { setup } from '../../lib/setup.mjs';
import { request } from '../../lib/client.mjs';

const titles = ['Release checklist', 'Team workspace', 'API reference', 'Project roadmap', 'Issue tracker', 'Build report', '发布检查', 'A long fixture title that should stay on a single line in the popup'];

test('popup controls, live state and bilingual layout in a disposable profile', { timeout: 90000 }, async t => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'tb-popup-'));
  const profile = path.join(temporary, 'profile'); await mkdir(profile);
  const previousHome = process.env.TABBRIDGE_HOME;
  process.env.TABBRIDGE_HOME = path.join(temporary, 'bridge');
  const server = http.createServer((req, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    const title = titles[Number(req.url.slice(1))] || 'Extra fixture';
    response.end(`<!doctype html><meta charset="utf-8"><title>${title}</title><h1>${title}</h1>`);
  });
  let context;
  const session = 'popup-fixture-session';
  const call = (method, params = {}) => request(method, params, { session });
  try {
    const installed = await setup({ manifestDir: path.join(profile, 'NativeMessagingHosts') });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    context = await chromium.launchPersistentContext(profile, {
      ...(process.env.TABBRIDGE_TEST_CHROME ? { executablePath: process.env.TABBRIDGE_TEST_CHROME } : { channel: 'chromium' }),
      headless: process.env.TABBRIDGE_TEST_HEADED !== '1', chromiumSandbox: true,
      args: [`--disable-extensions-except=${path.resolve('extension')}`, `--load-extension=${path.resolve('extension')}`],
      viewport: { width: 410, height: 600 }
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    await worker.evaluate(() => chrome.storage.local.set({ uiLanguage: 'en' }));
    const popup = await context.newPage();
    const errors = [];
    popup.on('pageerror', error => errors.push(error.message));
    await popup.goto(`chrome-extension://${installed.extensionId}/popup.html`);
    await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'ui.settings', quiet: false }));
    await popup.getByRole('button', { name: 'Connect', exact: true }).click();
    await popup.waitForFunction(() => document.getElementById('status').textContent === 'Connected to local host');
    const pages = [];
    for (let i = 0; i < titles.length; i++) { const page = await context.newPage(); await page.goto(`${base}/${i}`); pages.push(page); }
    await popup.waitForFunction(count => document.querySelectorAll('.tab').length === count, titles.length);
    const tabId = await popup.evaluate(async url => (await chrome.tabs.query({})).find(tab => tab.url === url).id, `${base}/0`);
    const row = popup.locator(`.tab[data-tab-id="${tabId}"]`);
    const settle = () => popup.waitForFunction(() => !document.getElementById('all-tabs').disabled && document.getElementById('tabs').getAttribute('aria-busy') === 'false');
    await mkdir('artifacts', { recursive: true });

    await t.test('access modes reflect actual authorization without implicit grants', async () => {
      assert.equal((await call('status')).allowAllTabs, false);
      assert.deepEqual((await call('tabs')).tabs, []);
      assert.equal(await row.locator('.badge.unshared').textContent(), 'Not shared');
      await popup.getByRole('radio', { name: 'All web tabs', exact: true }).check(); await settle();
      assert.equal((await call('status')).allowAllTabs, true);
      assert.equal(await row.locator('.badge.available').textContent(), 'Available');
      assert.equal(await popup.locator('#connect').isVisible(), false);
      assert.match(await popup.locator('#access-hint').textContent(), /read, control and close.*signed-in/);
    });
    await t.test('session and block changes update automatically while the domain stays visible', async () => {
      await call('claim', { tabId });
      await row.locator('.badge.in-use').waitFor();
      assert.equal(await row.locator('.tab-origin').textContent(), new URL(base).host);
      assert.match(await row.locator('.badge.in-use').getAttribute('title'), new RegExp(session));
      assert.doesNotMatch(await row.textContent(), new RegExp(session));
      await popup.locator('#filter').selectOption('in-use');
      assert.equal(await popup.locator('.tab').count(), 1);
      await call('release', { tabId });
      await popup.locator('#empty').waitFor();
      await popup.locator('#reset-filter').click();
      await row.getByRole('button', { name: `Block ${titles[0]}`, exact: true }).click(); await settle();
      await assert.rejects(call('snapshot', { tabId }), { code: 'TAB_BLOCKED' });
      await popup.locator('#filter').selectOption('blocked');
      assert.equal(await popup.locator('.tab').count(), 1);
      assert.equal(await row.locator('.badge.blocked').textContent(), 'Blocked');
      await row.getByRole('button', { name: `Allow ${titles[0]}`, exact: true }).click(); await settle();
      assert.equal(await popup.locator('.tab').count(), 0);
      await popup.locator('#reset-filter').click();
    });
    await t.test('search, current-tab ordering and list scrolling preserve the fixed stop control', async () => {
      await popup.locator('#search').fill('release');
      assert.equal(await popup.locator('.tab').count(), 1);
      await popup.locator('#search').fill('127.0.0.1');
      assert.equal(await popup.locator('.tab').count(), titles.length);
      await popup.locator('#search').fill('no fixture matches this');
      assert.equal(await popup.locator('#empty-text').textContent(), 'No matching tabs.');
      await popup.locator('#reset-filter').click();
      await popup.evaluate(tabId => chrome.tabs.update(tabId, { active: true }), tabId);
      await popup.waitForFunction(tabId => document.querySelector('.tab')?.dataset.tabId === String(tabId) && !!document.querySelector('.tab .badge.current'), tabId);
      const layout = await popup.evaluate(() => {
        const list = document.querySelector('.tab-list');
        const footer = document.querySelector('footer');
        const before = footer.getBoundingClientRect().top;
        list.scrollTop = list.scrollHeight;
        return { width: document.body.offsetWidth, pageWidth: document.documentElement.scrollWidth, contentWidth: document.body.scrollWidth, height: document.body.offsetHeight, pageHeight: document.documentElement.scrollHeight, scrollable: list.scrollHeight > list.clientHeight, fixed: before === footer.getBoundingClientRect().top, bottom: footer.getBoundingClientRect().bottom };
      });
      assert.deepEqual(layout, { width: 410, pageWidth: 410, contentWidth: 410, height: 600, pageHeight: 600, scrollable: true, fixed: true, bottom: 600 });
      assert.equal(await popup.getByRole('button', { name: 'Stop & revoke all', exact: true }).isVisible(), true);
      await popup.setViewportSize({ width: 410, height: 400 });
      await popup.waitForFunction(() => document.body.offsetHeight === 400);
      const shortLayout = await popup.evaluate(() => ({ pageHeight: document.documentElement.scrollHeight, stopBottom: document.getElementById('stop').getBoundingClientRect().bottom }));
      assert.equal(shortLayout.pageHeight, 400);
      assert.ok(shortLayout.stopBottom <= 400);
      await popup.setViewportSize({ width: 410, height: 600 });
      await popup.waitForFunction(() => document.body.offsetHeight === 600);
      await popup.evaluate(() => { document.querySelector('.tab-list').scrollTop = 0; document.activeElement?.blur(); });
      await popup.locator('body').screenshot({ path: 'artifacts/popup-en.png' });
      const extra = await context.newPage(); await extra.goto(`${base}/extra`);
      await popup.waitForFunction(count => document.querySelectorAll('.tab').length === count, titles.length + 1);
      await extra.close();
      await popup.waitForFunction(count => document.querySelectorAll('.tab').length === count, titles.length);
    });
    await t.test('language persists, version comes from the manifest and scripting remains explicit', async () => {
      const manifestVersion = await popup.evaluate(() => chrome.runtime.getManifest().version);
      assert.equal(await popup.locator('#version').textContent(), manifestVersion);
      assert.equal(await popup.locator('#developer').isVisible(), false);
      await assert.rejects(call('evaluate', { tabId, expression: 'document.title' }), { code: 'DEVELOPER_DISABLED' });
      await popup.locator('#advanced-settings > summary').click();
      await popup.locator('#developer').check(); await settle();
      assert.equal((await call('evaluate', { tabId, expression: 'document.title' })).value, titles[0]);
      await popup.locator('#advanced-settings > summary').click();
      assert.equal(await popup.locator('#developer-badge').isVisible(), true);
      await popup.locator('#language').selectOption('zh');
      assert.equal(await popup.getByRole('button', { name: '停止并撤销全部授权', exact: true }).isVisible(), true);
      assert.equal(await popup.locator('#developer-badge').textContent(), '脚本已启用');
      await popup.reload(); await settle();
      assert.equal(await popup.locator('#language').inputValue(), 'zh');
      assert.equal(await popup.locator('html').getAttribute('lang'), 'zh');
      assert.equal(await popup.locator('#advanced-settings').getAttribute('open'), null);
      assert.equal(await popup.locator('#developer-badge').isVisible(), true);
      await popup.locator('body').screenshot({ path: 'artifacts/popup-zh.png' });
      await popup.locator('#advanced-settings > summary').click();
      await popup.locator('body').screenshot({ path: 'artifacts/popup-advanced.png' });
      assert.equal(await popup.evaluate(() => document.documentElement.scrollHeight), 600);
      assert.equal(await popup.evaluate(() => document.body.scrollWidth), 410);
      await popup.locator('#developer').uncheck(); await settle();
      await popup.locator('#advanced-settings > summary').click();
    });
    await t.test('connection details and copied diagnostics contain no page or session data', async () => {
      // Capture the clipboard payload inside this disposable extension page;
      // do not change the machine's shared clipboard during an automated test.
      await popup.evaluate(() => { navigator.clipboard.writeText = async text => { window.copiedDiagnostics = text; }; });
      await popup.getByRole('button', { name: '诊断', exact: true }).click();
      assert.equal(await popup.locator('#diagnostic-connection').textContent(), '本地主机已连接');
      assert.equal(await popup.locator('#diagnostic-mode').textContent(), '所有网页');
      await popup.getByRole('button', { name: '复制诊断信息', exact: true }).click();
      await popup.waitForFunction(() => document.getElementById('copy-status').textContent === '已复制');
      const payload = await popup.evaluate(() => window.copiedDiagnostics);
      const diagnostic = JSON.parse(payload);
      assert.equal(diagnostic.connected, true); assert.equal(diagnostic.webTabs, titles.length);
      assert.equal(diagnostic.allowAllTabs, true); assert.equal(diagnostic.developer, false);
      assert.doesNotMatch(payload, /127\.0\.0\.1|Release checklist|popup-fixture-session/);
      await popup.locator('body').screenshot({ path: 'artifacts/popup-diagnostics.png' });
      assert.equal(await popup.getByRole('button', { name: '停止并撤销全部授权', exact: true }).isVisible(), true);
      await popup.keyboard.press('Escape');
      assert.equal(await popup.locator('#diagnostics-panel').isVisible(), false);
      assert.equal(await popup.locator('#diagnostics').evaluate(element => element === document.activeElement), true);
    });
    await t.test('failed writes roll back to backend state without replay and keep Stop available', async () => {
      await popup.evaluate(() => {
        const original = chrome.runtime.sendMessage.bind(chrome.runtime);
        window.uiWriteAttempts = [];
        window.restoreMessages = () => { chrome.runtime.sendMessage = original; };
        chrome.runtime.sendMessage = async message => {
          if (message.type === 'ui.settings' || message.type === 'ui.stop') {
            window.uiWriteAttempts.push(message.type);
            return { error: 'Fixture refused UI write', code: 'BROWSER_ERROR' };
          }
          return original(message);
        };
      });
      try {
        // A refused write correctly reverts the radio, so click rather than
        // check(), whose postcondition requires the new value to stay checked.
        await popup.getByRole('radio', { name: '逐个授权', exact: true }).click(); await settle();
        assert.equal((await call('status')).allowAllTabs, true);
        assert.equal(await popup.locator('#all-tabs').isChecked(), true);
        assert.equal(await popup.locator('#error').textContent(), 'Fixture refused UI write');
        await popup.getByRole('button', { name: '停止并撤销全部授权', exact: true }).click(); await settle();
        assert.equal((await call('status')).connected, true);
        assert.equal(await popup.getByRole('button', { name: '停止并撤销全部授权', exact: true }).isEnabled(), true);
        assert.deepEqual(await popup.evaluate(() => window.uiWriteAttempts), ['ui.settings', 'ui.stop']);
      } finally { await popup.evaluate(() => window.restoreMessages()); }
      await popup.locator('#refresh').click(); await settle();
      assert.equal(await popup.locator('#error').isVisible(), false);
    });
    await t.test('quiet controls persist, gate scripting and expose optional focus emulation', async () => {
      await popup.locator('#quiet').check(); await settle();
      assert.equal((await call('status')).quiet, true);
      await popup.locator('#advanced-settings > summary').click();
      assert.equal(await popup.locator('#developer').isDisabled(), true);
      assert.equal(await popup.locator('#focus-emulation').isEnabled(), true);
      await popup.locator('#focus-emulation').check(); await settle();
      assert.equal((await call('status')).focusEmulation, true);
      assert.equal(await popup.locator('#emulation-badge').textContent(), '模拟已启用');
      await popup.locator('#advanced-settings > summary').click();
      await popup.reload(); await settle();
      assert.equal(await popup.locator('#quiet').isChecked(), true);
      assert.equal(await popup.locator('#emulation-badge').isVisible(), true);
      await popup.locator('body').screenshot({ path: 'artifacts/popup-quiet-zh.png' });
      await popup.locator('#language').selectOption('en');
      await popup.locator('body').screenshot({ path: 'artifacts/popup-quiet-en.png' });
      await popup.locator('#advanced-settings > summary').click();
      await popup.locator('body').screenshot({ path: 'artifacts/popup-quiet-advanced.png' });
      assert.equal(await popup.evaluate(() => document.documentElement.scrollHeight), 600);
      assert.equal(await popup.evaluate(() => document.body.scrollWidth), 410);
      await popup.locator('#focus-emulation').uncheck(); await settle();
      await popup.locator('#advanced-settings > summary').click();
      await popup.locator('#language').selectOption('zh');
    });
    await t.test('individual mode and fixed stop revoke backend access as displayed', async () => {
      await popup.getByRole('radio', { name: '逐个授权', exact: true }).check(); await settle();
      assert.equal((await call('status')).allowAllTabs, false);
      await assert.rejects(call('snapshot', { tabId }), { code: 'TAB_NOT_GRANTED' });
      await row.getByRole('button', { name: `分享 ${titles[0]}`, exact: true }).click(); await settle();
      await call('claim', { tabId }); await row.locator('.badge.in-use').waitFor();
      await popup.getByRole('button', { name: '停止并撤销全部授权', exact: true }).click();
      await popup.waitForFunction(() => document.getElementById('status').textContent === '未连接' && !document.getElementById('all-tabs').disabled);
      assert.equal(await row.locator('.badge.unshared').textContent(), '未授权');
      await assert.rejects(call('status'), e => ['NOT_CONNECTED', 'DISCONNECTED'].includes(e.code));
      assert.equal(await popup.locator('#new-tabs').isChecked(), false);
      assert.equal(await popup.locator('#developer').isChecked(), false);
      assert.deepEqual(errors, []);
    });
  } finally {
    await context?.close();
    await new Promise(resolve => server.close(resolve));
    if (previousHome === undefined) delete process.env.TABBRIDGE_HOME; else process.env.TABBRIDGE_HOME = previousHome;
    await rm(temporary, { recursive: true, force: true });
  }
});
