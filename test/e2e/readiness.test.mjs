import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { chromium } from 'playwright';
import { setup } from '../../lib/setup.mjs';
import { request } from '../../lib/client.mjs';

const documentHTML = '<!doctype html><meta charset="utf-8"><title>Readiness fixture</title><h1>Readiness fixture</h1><p>Expected ready content</p>';
function gate() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }

test('initial navigation and DOM readiness are bounded and preserve authorization', { timeout: 90000 }, async t => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'tb-ready-'));
  const profile = path.join(temporary, 'profile'); await mkdir(profile);
  const previousHome = process.env.TABBRIDGE_HOME;
  process.env.TABBRIDGE_HOME = path.join(temporary, 'bridge');
  const held = new Map(); const hits = new Map();
  const server = http.createServer((req, response) => {
    hits.set(req.url, (hits.get(req.url) || 0) + 1);
    const entry = held.get(req.url);
    if (entry) {
      entry.response = response; entry.received.resolve();
      return;
    }
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(documentHTML);
  });
  function hold(route) { const entry = { received: gate() }; held.set(route, entry); return entry; }
  function finish(entry, body = documentHTML, type = 'text/html; charset=utf-8') {
    if (entry.response.writableEnded || entry.response.destroyed) return;
    entry.response.setHeader('Content-Type', type); entry.response.end(body);
  }
  let context;
  const call = (method, params = {}, session = 'readiness') => request(method, params, { session });
  try {
    const installed = await setup({ manifestDir: path.join(profile, 'NativeMessagingHosts') });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    context = await chromium.launchPersistentContext(profile, {
      ...(process.env.TABBRIDGE_TEST_CHROME ? { executablePath: process.env.TABBRIDGE_TEST_CHROME } : { channel: 'chromium' }),
      headless: process.env.TABBRIDGE_TEST_HEADED !== '1', chromiumSandbox: true,
      args: [`--disable-extensions-except=${path.resolve('extension')}`, `--load-extension=${path.resolve('extension')}`]
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    await worker.evaluate(() => chrome.storage.local.set({ uiLanguage: 'en' }));
    const popup = await context.newPage(); await popup.goto(`chrome-extension://${installed.extensionId}/popup.html`);
    await popup.getByRole('button', { name: 'Connect', exact: true }).click();
    await popup.waitForFunction(() => document.getElementById('status').textContent === 'Connected to local host');
    await popup.getByRole('checkbox', { name: 'Agent-created tabs', exact: true }).check();
    await popup.waitForFunction(() => !document.getElementById('new-tabs').disabled);
    const tab = tabId => popup.evaluate(tabId => chrome.tabs.get(tabId), tabId);

    await t.test('snapshot, read, screenshot and text wait survive actual uncommitted new tabs', async () => {
      for (const method of ['snapshot', 'read', 'screenshot', 'wait']) {
        const route = `/initial-${method}`;
        const entry = hold(route);
        const own = await call('open', { url: base + route });
        await entry.received.promise;
        const before = await tab(own.tabId);
        assert.ok(!before.url || before.url === 'about:blank', JSON.stringify(before));
        assert.equal(before.pendingUrl, base + route);
        assert.equal(own.loading, true);
        const listed = (await call('tabs')).tabs.find(tab => tab.tabId === own.tabId);
        assert.equal(listed.committed, false); assert.equal(listed.loading, true);
        assert.equal(listed.url, base + route);
        const other = await call('snapshot', { tabId: own.tabId, timeoutMs: 50 }, 'foreign').catch(error => error);
        assert.equal(other.code, 'SESSION_CONFLICT');
        let settled = false;
        const reading = call(method, { tabId: own.tabId, timeoutMs: 3000, ...(method === 'wait' ? { text: 'Expected ready content' } : {}) });
        reading.then(() => { settled = true; }, () => { settled = true; });
        await new Promise(resolve => setTimeout(resolve, 100));
        assert.equal(settled, false, `${method} read an uncommitted document`);
        finish(entry);
        const result = await reading;
        if (method === 'snapshot' || method === 'read') {
          assert.match(result.text, /Expected ready content/);
          assert.equal(result.url, base + route);
          assert.ok(['interactive', 'complete'].includes(result.readyState));
          assert.equal(typeof result.documentFocused, 'boolean');
        } else if (method === 'screenshot') assert.equal(Buffer.from(result.data, 'base64').subarray(1, 4).toString(), 'PNG');
        else assert.equal(result.found, true);
        assert.equal((await tab(own.tabId)).active, false, 'A read must not activate a tab');
        assert.equal(hits.get(route), 1, 'A read must not reopen or reload the page');
        await call('close', { tabId: own.tabId });
      }
    });
    await t.test('an interactive document is awaited with one budget covering navigation and DOM parsing', async () => {
      const route = '/parser'; const entry = hold(route); const script = hold('/parser.js');
      const pageCreated = context.waitForEvent('page');
      const own = await call('open', { url: base + route }); await entry.received.promise;
      const reading = call('read', { tabId: own.tabId, timeoutMs: 3000 });
      reading.catch(() => {});
      finish(entry, '<!doctype html><title>Parser fixture</title><script src="/parser.js" defer></script><h1>Partial content</h1><p id="result">Not ready</p>');
      await script.received.promise;
      const page = await pageCreated;
      await page.waitForURL(base + route, { waitUntil: 'commit' });
      const before = await page.evaluate(() => ({ readyState: document.readyState, domContentLoaded: (performance.getEntriesByType('navigation')[0]?.domContentLoadedEventEnd || 0) > 0 }));
      assert.ok(['loading', 'interactive'].includes(before.readyState));
      assert.equal(before.domContentLoaded, false);
      // The initial URL is committed, but deferred code and DOMContentLoaded
      // have not completed: the partial body must not be returned as ready.
      finish(script, 'document.getElementById("result").textContent="Deferred app ready";', 'application/javascript');
      const result = await reading;
      assert.match(result.text, /Deferred app ready/);
      assert.ok(['interactive', 'complete'].includes(result.readyState));
      assert.equal(result.domContentLoaded, true);
      assert.equal(hits.get(route), 1); assert.equal(hits.get('/parser.js'), 1);
      await call('close', { tabId: own.tabId });

      const slow = hold('/budget'); const deferred = hold('/budget.js');
      const budget = await call('open', { url: base + '/budget' }); await slow.received.promise;
      const started = Date.now();
      const expired = call('snapshot', { tabId: budget.tabId, timeoutMs: 1500 }).catch(error => error);
      await new Promise(resolve => setTimeout(resolve, 900));
      finish(slow, '<!doctype html><title>Budget fixture</title><script src="/budget.js" defer></script><h1>Partial budget body</h1>');
      await deferred.received.promise;
      // Content completes after the original 1.5s budget but before a wrongly
      // renewed DOM budget would expire. Check the outcome, not tight timing.
      const release = setTimeout(() => finish(deferred, '', 'application/javascript'), Math.max(0, 2000 - (Date.now() - started)));
      try { assert.equal((await expired).code, 'READINESS_TIMEOUT'); }
      finally { clearTimeout(release); finish(deferred, '', 'application/javascript'); }
      await call('wait', { tabId: budget.tabId, text: 'Partial budget body' });
      await call('close', { tabId: budget.tabId });
    });
    await t.test('a pending follow-up navigation cannot return the previously committed page', async () => {
      const own = await call('open', { url: base + '/before-followup' });
      await call('wait', { tabId: own.tabId, text: 'Expected ready content' });
      const entry = hold('/after-followup');
      await popup.evaluate(({ tabId, url }) => chrome.tabs.update(tabId, { url }), { tabId: own.tabId, url: base + '/after-followup' });
      await entry.received.promise;
      assert.equal((await tab(own.tabId)).url, base + '/before-followup');
      let settled = false;
      const reading = call('snapshot', { tabId: own.tabId, timeoutMs: 3000 });
      reading.then(() => { settled = true; }, () => { settled = true; });
      await new Promise(resolve => setTimeout(resolve, 100));
      assert.equal(settled, false);
      finish(entry, '<!doctype html><title>Destination fixture</title><h1>Correct destination content</h1>');
      const result = await reading;
      assert.equal(result.url, base + '/after-followup');
      assert.match(result.text, /Correct destination content/);
      assert.doesNotMatch(result.text, /Expected ready content/);
      assert.equal(hits.get('/after-followup'), 1);
      await call('close', { tabId: own.tabId });
    });
    await t.test('waiting on an unshared pending tab requires the explicit global mode and ends on revocation', async () => {
      const entry = hold('/global-pending');
      const unshared = await popup.evaluate(url => chrome.tabs.create({ url, active: false }), base + '/global-pending');
      await entry.received.promise;
      await assert.rejects(call('read', { tabId: unshared.id, timeoutMs: 50 }), { code: 'TAB_NOT_GRANTED' });
      await popup.getByRole('radio', { name: 'All web tabs', exact: true }).check();
      await popup.waitForFunction(() => !document.getElementById('all-tabs').disabled);
      const reading = call('read', { tabId: unshared.id, timeoutMs: 3000 });
      reading.catch(() => {});
      finish(entry);
      assert.match((await reading).text, /Expected ready content/);
      await assert.rejects(call('read', { tabId: unshared.id }, 'foreign'), { code: 'SESSION_CONFLICT' });
      await call('close', { tabId: unshared.id });

      const revoked = hold('/global-revoked');
      const pending = await popup.evaluate(url => chrome.tabs.create({ url, active: false }), base + '/global-revoked');
      await revoked.received.promise;
      const waiting = call('read', { tabId: pending.id, timeoutMs: 3000 }).catch(error => error);
      await new Promise(resolve => setTimeout(resolve, 100));
      await popup.getByRole('radio', { name: 'Individual tabs', exact: true }).check();
      await popup.waitForFunction(() => !document.getElementById('all-tabs').disabled);
      assert.equal((await call('status')).allowAllTabs, false);
      assert.equal((await waiting).code, 'TAB_NOT_GRANTED');
      await popup.evaluate(tabId => chrome.tabs.remove(tabId), pending.id);
    });
    await t.test('pending navigation times out accurately and the owned tab remains closable', async () => {
      const entry = hold('/timeout');
      const own = await call('open', { url: base + '/timeout' }); await entry.received.promise;
      const started = Date.now();
      await assert.rejects(call('snapshot', { tabId: own.tabId, timeoutMs: 150 }), { code: 'PAGE_LOADING' });
      assert.ok(Date.now() - started < 1500);
      assert.equal(hits.get('/timeout'), 1);
      await call('close', { tabId: own.tabId });
    });
    await t.test('revocation during initial loading aborts the read without inspecting or restoring the grant', async () => {
      const entry = hold('/revoked');
      const own = await call('open', { url: base + '/revoked' }); await entry.received.promise;
      const reading = call('read', { tabId: own.tabId, timeoutMs: 3000 }).catch(error => error);
      await new Promise(resolve => setTimeout(resolve, 100));
      await popup.evaluate(tabId => chrome.runtime.sendMessage({ type: 'ui.revoke', tabId }), own.tabId);
      assert.equal((await reading).code, 'TAB_NOT_GRANTED');
      assert.ok(!(await call('tabs')).tabs.some(tab => tab.tabId === own.tabId));
      finish(entry);
      await assert.rejects(call('snapshot', { tabId: own.tabId }), { code: 'TAB_NOT_GRANTED' });
      await popup.evaluate(tabId => chrome.tabs.remove(tabId), own.tabId);
    });
    await t.test('the initial blank exception expires on commit and never authorizes ordinary blank tabs', async () => {
      assert.equal((await call('status')).allowAllTabs, false);
      const own = await call('open', { url: base + '/committed' });
      // No TabBridge read may be needed to expire the initial exception; it
      // must also be removed from session storage before a worker restart.
      await popup.waitForFunction(async ({ tabId, url }) => {
        const tab = await chrome.tabs.get(tabId);
        const { leases } = await chrome.storage.session.get('leases');
        return tab.url === url && tab.status === 'complete' && leases[tabId] && !leases[tabId].openingUrl;
      }, { tabId: own.tabId, url: base + '/committed' });
      await popup.evaluate(tabId => chrome.tabs.update(tabId, { url: 'about:blank' }), own.tabId);
      // Wait for the actual blank navigation and durable revocation, not just
      // one UI status response while Chrome is still reporting a transition.
      await popup.waitForFunction(async tabId => {
        const [tab, state, stored] = await Promise.all([
          chrome.tabs.get(tabId), chrome.runtime.sendMessage({ type: 'ui.status' }), chrome.storage.session.get('leases')
        ]);
        return tab.url === 'about:blank' && tab.status === 'complete' && !tab.pendingUrl && !state.leases[tabId] && !stored.leases?.[tabId];
      }, own.tabId);
      assert.ok(!(await call('tabs')).tabs.some(tab => tab.tabId === own.tabId));
      await assert.rejects(call('read', { tabId: own.tabId, timeoutMs: 50 }), { code: 'TAB_NOT_GRANTED' });
      const blank = await popup.evaluate(() => chrome.tabs.create({ url: 'about:blank', active: false }));
      await assert.rejects(call('snapshot', { tabId: blank.id, timeoutMs: 50 }), { code: 'TAB_NOT_GRANTED' });
      await assert.rejects(call('open', { url: 'about:blank' }), { code: 'INVALID_URL' });
      await popup.evaluate(ids => chrome.tabs.remove(ids), [own.tabId, blank.id]);
    });
  } finally {
    await context?.close();
    await new Promise(resolve => server.close(resolve));
    if (previousHome === undefined) delete process.env.TABBRIDGE_HOME; else process.env.TABBRIDGE_HOME = previousHome;
    await rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
