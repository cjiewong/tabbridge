import { fail, webURL, requireTabId, requireLease, validSession } from './policy.js';
import { detach, invalidate, runAction } from './browser.js';

const HOST = 'io.github.cjiewong.tabbridge';
let port; let connected = false; let lastError = ''; let reconnectTimer; let retryDelay = 500;
let settings = { enabled: false, allowNewTabs: false, developer: false };
let leases = {}; const locks = new Map(); const activeRequests = new Map();
const ready = Promise.all([chrome.storage.local.get('settings'), chrome.storage.session.get('leases')]).then(([local, session]) => {
  settings = { ...settings, ...local.settings }; leases = session.leases || {};
});
async function saveLeases() { await chrome.storage.session.set({ leases }); updateBadge(); }
function updateBadge() {
  chrome.action.setBadgeText({ text: connected ? String(Object.keys(leases).length || '') : settings.enabled ? '!' : '' });
  chrome.action.setBadgeBackgroundColor({ color: connected ? '#16705b' : '#b65521' });
}
function connect() {
  if (port || !settings.enabled) return;
  try {
    port = chrome.runtime.connectNative(HOST);
    const activePort = port;
    port.onDisconnect.addListener(() => {
      if (port !== activePort) return;
      lastError = chrome.runtime.lastError?.message || 'Native host disconnected'; port = null; connected = false; updateBadge();
      clearTimeout(reconnectTimer);
      if (settings.enabled) { reconnectTimer = setTimeout(connect, retryDelay); retryDelay = Math.min(10000, retryDelay * 2); }
    });
    port.onMessage.addListener(message => {
      if (message.type === 'welcome') { connected = true; retryDelay = 500; lastError = ''; updateBadge(); return; }
      if (message.type === 'cancel') { const active = activeRequests.get(message.id); if (active) active.cancelled = true; return; }
      if (message.type !== 'request') return;
      const control = { cancelled: false }; activeRequests.set(message.id, control);
      execute(message, control).then(result => {
        if (port === activePort) activePort.postMessage({ id: message.id, result });
      }).catch(e => {
        if (port === activePort) activePort.postMessage({ id: message.id, error: { code: e.code || 'BROWSER_ERROR', message: e.message || String(e) } });
      }).finally(() => activeRequests.delete(message.id));
    });
    port.postMessage({ type: 'hello', protocol: 1, version: chrome.runtime.getManifest().version, extensionId: chrome.runtime.id });
  } catch (e) { lastError = e.message; port = null; }
}
function serial(key, operation) {
  const previous = locks.get(key) || Promise.resolve();
  const next = previous.catch(() => {}).then(operation); locks.set(key, next);
  next.finally(() => { if (locks.get(key) === next) locks.delete(key); }).catch(() => {});
  return next;
}
async function execute(message, control) {
  await ready;
  if (!validSession(message.session) || !message.params || typeof message.params !== 'object' || Array.isArray(message.params)) fail('INVALID_REQUEST', 'Invalid session or parameters');
  if (!settings.enabled) fail('STOPPED', 'TabBridge is stopped');
  return serial(message.params.tabId ?? `global:${message.session}`, () => {
    if (control.cancelled) fail('CANCELLED', 'Client disconnected before execution; no action was started');
    if (!Number.isFinite(message.deadline) || Date.now() >= message.deadline) fail('EXPIRED', 'Request expired before execution; no action was started');
    return dispatch(message.method, message.params, message.session, message.deadline, control);
  });
}
async function dispatch(method, params, session, deadline, control) {
  if (!settings.enabled) fail('STOPPED', 'TabBridge is stopped');
  if (method === 'status') return { connected, version: chrome.runtime.getManifest().version, protocol: 1, allowNewTabs: settings.allowNewTabs, developer: settings.developer, session };
  if (method === 'tabs') {
    const result = [];
    for (const [id, lease] of Object.entries(leases)) {
      if (lease.session && lease.session !== session) continue;
      try { const tab = await chrome.tabs.get(Number(id)); result.push({ tabId: tab.id, title: tab.title, url: tab.url, owned: lease.owned, claimed: !!lease.session }); } catch {}
    }
    return { tabs: result };
  }
  if (method === 'open') {
    if (!settings.allowNewTabs) fail('NEW_TABS_DISABLED', 'Enable agent-created tabs in the TabBridge popup');
    const url = webURL(params.url).href;
    const tab = await chrome.tabs.create({ url, active: false });
    leases[tab.id] = { owned: true, session, origin: new URL(url).origin }; await saveLeases();
    return { tabId: tab.id, url, owned: true };
  }
  const tabId = requireTabId(params.tabId); const tab = await chrome.tabs.get(tabId); const lease = leases[tabId];
  if (method === 'claim') {
    if (!lease) fail('TAB_NOT_GRANTED', 'Share this tab from the extension popup');
    if (lease.session && lease.session !== session) fail('SESSION_CONFLICT', 'Tab is claimed by another session');
    if (!lease.owned && webURL(tab.url).origin !== lease.origin) fail('ORIGIN_CHANGED', 'Share this tab again after its origin changed');
    lease.session = session; await saveLeases(); return { tabId, title: tab.title, url: tab.url };
  }
  requireLease(lease, session, tab.url);
  if (method === 'release') {
    await detach(tabId);
    if (lease.owned) delete leases[tabId]; else lease.session = null;
    await saveLeases(); return { released: tabId, tabKeptOpen: true };
  }
  if (method === 'close') {
    if (!lease.owned) fail('USER_TAB', 'Agent cannot close a user-owned tab. Release it instead');
    await chrome.tabs.remove(tabId); delete leases[tabId]; await saveLeases(); return { closed: tabId };
  }
  if (method === 'batch') {
    if (!Array.isArray(params.steps) || params.steps.length < 1 || params.steps.length > 12) fail('INVALID_PARAMS', 'batch requires 1–12 steps');
    const allowed = new Set(['click', 'fill', 'press', 'select', 'scroll', 'wait']);
    // Validate the entire batch before doing anything.
    for (const step of params.steps) if (!step || !allowed.has(step.method) || !step.params || typeof step.params !== 'object' || Array.isArray(step.params) || 'tabId' in step.params) fail('INVALID_PARAMS', 'Invalid batch step');
    const results = [];
    for (const step of params.steps) {
      if (control.cancelled) return { completed: results.length, results, failed: { code: 'CANCELLED', message: 'Client disconnected' }, outcome: 'partial; do not replay completed steps' };
      if (Date.now() >= deadline) return { completed: results.length, results, failed: { code: 'EXPIRED', message: 'Batch deadline reached' }, outcome: 'partial; do not replay completed steps' };
      if (!settings.enabled) fail('STOPPED', 'TabBridge was stopped');
      requireLease(leases[tabId], session, (await chrome.tabs.get(tabId)).url);
      try { results.push(await runAction(step.method, tabId, step.params, settings)); }
      catch (e) { return { completed: results.length, results, failed: { code: e.code || 'BROWSER_ERROR', message: e.message }, outcome: 'partial; do not replay completed steps' }; }
    }
    return { completed: results.length, results, snapshot: await runAction('snapshot', tabId, {}, settings) };
  }
  if (method === 'navigate' && !lease.owned && webURL(params.url).origin !== lease.origin) fail('ORIGIN_CHANGED', 'Shared tabs may only navigate within the granted origin. Create a new tab instead');
  return runAction(method, tabId, params, settings);
}

chrome.tabs.onRemoved.addListener(tabId => { delete leases[tabId]; detach(tabId); saveLeases(); });
chrome.tabs.onUpdated.addListener(async (tabId, change) => {
  await ready;
  if (!change.url) return;
  invalidate(tabId); const lease = leases[tabId];
  if (!lease) return;
  let allowed = false; try { const url = webURL(change.url); allowed = lease.owned || url.origin === lease.origin; } catch {}
  if (!allowed) { delete leases[tabId]; await detach(tabId); await saveLeases(); }
});
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Only our own extension pages can change access, never a website/content script.
  if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL(''))) return false;
  (async () => {
    await ready;
    switch (message.type) {
      case 'ui.status': return { connected, lastError, settings, leases, tabs: (await chrome.tabs.query({})).filter(t => /^https?:/.test(t.url || '')).map(t => ({ id: t.id, title: t.title, url: t.url })) };
      case 'ui.connect': settings.enabled = true; await chrome.storage.local.set({ settings }); connect(); return { ok: true };
      case 'ui.settings': {
        for (const key of ['allowNewTabs', 'developer']) if (typeof message[key] === 'boolean') settings[key] = message[key];
        await chrome.storage.local.set({ settings }); return { ok: true };
      }
      case 'ui.grant': {
        const tab = await chrome.tabs.get(requireTabId(message.tabId));
        if (leases[tab.id]?.session) fail('SESSION_CONFLICT', 'Revoke the existing session before sharing this tab again');
        leases[tab.id] = { owned: false, session: null, origin: webURL(tab.url).origin }; await saveLeases(); return { ok: true };
      }
      case 'ui.revoke': delete leases[message.tabId]; await detach(message.tabId); await saveLeases(); return { ok: true };
      case 'ui.stop': {
        settings.enabled = false; settings.allowNewTabs = false; settings.developer = false;
        await chrome.storage.local.set({ settings });
        for (const id of Object.keys(leases)) await detach(Number(id));
        leases = {}; await saveLeases(); clearTimeout(reconnectTimer);
        port?.disconnect(); port = null; connected = false; updateBadge(); return { ok: true };
      }
      default: fail('INVALID_METHOD', 'Unknown UI action');
    }
  })().then(sendResponse).catch(e => sendResponse({ error: e.message }));
  return true;
});
chrome.alarms.create('reconnect', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener(() => { if (!port) connect(); });
ready.then(() => { updateBadge(); connect(); });
