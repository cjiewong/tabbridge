import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

test('native toolbar popup keeps Stop inside Chrome’s actual available viewport', { timeout: 30000 }, async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'tb-native-popup-'));
  const server = http.createServer((_req, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end('<!doctype html><title>Native popup fixture</title><h1>Local fixture</h1>');
  });
  let context;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    context = await chromium.launchPersistentContext(temporary, {
      ...(process.env.TABBRIDGE_TEST_CHROME ? { executablePath: process.env.TABBRIDGE_TEST_CHROME } : { channel: 'chromium' }),
      headless: process.env.TABBRIDGE_TEST_HEADED !== '1', chromiumSandbox: true,
      args: [`--disable-extensions-except=${path.resolve('extension')}`, `--load-extension=${path.resolve('extension')}`],
      viewport: { width: 800, height: 600 }, deviceScaleFactor: 1
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    await worker.evaluate(() => chrome.storage.local.set({ uiLanguage: 'en' }));
    const page = await context.newPage(); await page.goto(`http://127.0.0.1:${server.address().port}/`);
    const cdp = await context.browser().newBrowserCDPSession();
    await worker.evaluate(() => chrome.action.openPopup());
    const target = (await cdp.send('Target.getTargets')).targetInfos.find(target => target.url.endsWith('/popup.html'));
    assert.ok(target, 'Chrome did not create the action popup');
    // Chrome action popups are not exposed in Playwright's context.pages().
    // Inspect only the target in our own disposable, sandboxed browser.
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: false });
    const pending = new Map(); let nextId = 1;
    cdp.on('Target.receivedMessageFromTarget', event => {
      if (event.sessionId !== sessionId) return;
      const reply = JSON.parse(event.message);
      const waiter = pending.get(reply.id);
      if (!waiter) return;
      clearTimeout(waiter.timer); pending.delete(reply.id);
      if (reply.error) waiter.reject(new Error(reply.error.message)); else waiter.resolve(reply.result);
    });
    const popupCall = (method, params = {}) => new Promise((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Native popup ${method} timed out`)); }, 10000);
      pending.set(id, { resolve, reject, timer });
      cdp.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id, method, params }) }).catch(error => { clearTimeout(timer); pending.delete(id); reject(error); });
    });
    await popupCall('Runtime.evaluate', {
      expression: "new Promise(resolve=>document.readyState==='complete'?resolve():window.addEventListener('load',resolve,{once:true}))",
      awaitPromise: true
    });
    // Capture forces the first frame, including the popup's resize/fit callback.
    await popupCall('Page.captureScreenshot', { format: 'png' });
    const result = await popupCall('Runtime.evaluate', {
      expression: `JSON.stringify({width:innerWidth,height:innerHeight,bodyHeight:document.body.offsetHeight,bodyWidth:document.body.scrollWidth,scrollHeight:document.documentElement.scrollHeight,stopTop:document.getElementById('stop').getBoundingClientRect().top,stopBottom:document.getElementById('stop').getBoundingClientRect().bottom})`,
      returnByValue: true
    });
    const metrics = JSON.parse(result.result.value);
    assert.equal(metrics.width, 410);
    assert.equal(metrics.bodyWidth, 410);
    assert.ok(metrics.height > 200 && metrics.height <= 600, JSON.stringify(metrics));
    assert.equal(metrics.bodyHeight, metrics.height);
    assert.ok(metrics.scrollHeight <= metrics.height + 1, JSON.stringify(metrics));
    assert.ok(metrics.stopTop >= 0 && metrics.stopBottom <= metrics.height, JSON.stringify(metrics));
    const screenshot = await popupCall('Page.captureScreenshot', { format: 'png' });
    await mkdir('artifacts', { recursive: true });
    await writeFile('artifacts/native-popup.png', Buffer.from(screenshot.data, 'base64'));
    await cdp.detach();
  } finally {
    await context?.close();
    await new Promise(resolve => server.close(resolve));
    await rm(temporary, { recursive: true, force: true });
  }
});
