import test from 'node:test';
import assert from 'node:assert/strict';
import { frame, FrameDecoder, validateRequest } from '../lib/protocol.mjs';
import { requireLease, webURL, pendingWebURL } from '../extension/policy.js';

test('framing survives bytewise fragmentation and multiple messages', async () => {
  const decoder = new FrameDecoder(); const messages = [];
  decoder.on('data', value => messages.push(value));
  const data = Buffer.concat([frame({ text: '你好' }), frame({ id: 2 })]);
  for (const byte of data) decoder.write(Buffer.from([byte]));
  decoder.end(); await new Promise((resolve, reject) => { decoder.on('end', resolve); decoder.on('error', reject); });
  assert.deepEqual(messages, [{ text: '你好' }, { id: 2 }]);
});
test('malformed or truncated frames fail closed', async () => {
  for (const data of [Buffer.from([255, 255, 255, 255]), Buffer.from([4, 0, 0, 0, 123])]) {
    const d = new FrameDecoder(); const error = new Promise(resolve => d.on('error', resolve)); d.resume(); d.end(data);
    assert.ok((await error).code);
  }
});
test('session and method validation rejects ambiguous input', () => {
  assert.throws(() => validateRequest({ method: 'tabs', session: '../other', params: {} }), /Session/);
  assert.throws(() => validateRequest({ method: 'exec', session: 'ok', params: {} }), /Unknown/);
});
test('tab grants enforce ownership and origin independently', () => {
  const lease = { session: 'alpha', owned: false, origin: 'https://example.com' };
  assert.throws(() => requireLease(lease, 'beta', 'https://example.com'), /another session/);
  assert.throws(() => requireLease(lease, 'alpha', 'https://other.example'), /changed origin/);
  assert.throws(() => requireLease(null, 'alpha', 'https://example.com'), /Share this tab/);
  assert.equal(requireLease(lease, 'alpha', 'https://example.com/page').hostname, 'example.com');
  for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'https://user:password@example.com']) assert.throws(() => webURL(url));
});
test('all-tab grants require the active option and still enforce ownership and web schemes', () => {
  const lease = { session: 'alpha', owned: false, origin: 'https://example.com', grant: 'all' };
  assert.throws(() => requireLease(lease, 'alpha', 'https://example.com'), { code: 'TAB_NOT_GRANTED' });
  assert.equal(requireLease(lease, 'alpha', 'https://other.example', { allowAllTabs: true }).hostname, 'other.example');
  assert.throws(() => requireLease(lease, 'beta', 'https://other.example', { allowAllTabs: true }), { code: 'SESSION_CONFLICT' });
  assert.throws(() => requireLease(lease, 'alpha', 'chrome://settings', { allowAllTabs: true }), { code: 'INVALID_URL' });
});

test('waiting for an initial URL requires ownership or a pending global web navigation', () => {
  const lease = { session: 'alpha', owned: true, openingUrl: 'https://example.com/', origin: 'https://example.com' };
  const blank = { url: 'about:blank', pendingUrl: 'https://example.com/', status: 'loading' };
  assert.equal(pendingWebURL(blank, lease, 'alpha').href, 'https://example.com/');
  assert.throws(() => pendingWebURL(blank, lease, 'beta'), { code: 'SESSION_CONFLICT' });
  assert.equal(pendingWebURL(blank, null, 'alpha'), null);
  assert.equal(pendingWebURL(blank, { ...lease, owned: false }, 'alpha'), null);
  assert.equal(pendingWebURL({ url: 'about:blank' }, null, 'alpha', { allowAllTabs: true }), null);
  assert.equal(pendingWebURL(blank, null, 'alpha', { allowAllTabs: true }).href, 'https://example.com/');
  assert.equal(pendingWebURL({ ...blank, url: 'chrome://settings' }, lease, 'alpha'), null);
  assert.equal(pendingWebURL({ url: 'about:blank' }, { ...lease, openingUrl: undefined }, 'alpha'), null);
  for (const pendingUrl of ['file:///private/fixture', 'chrome://settings', 'https://user:pass@example.com']) {
    assert.throws(() => pendingWebURL({ ...blank, pendingUrl }, lease, 'alpha'), { code: 'INVALID_URL' });
  }
});
