import { fail, webURL, requireTabId, requireLease, validSession, pendingWebURL } from './policy.js';
import { detach, invalidate, runAction, resetBrowserSessions } from './browser.js';

const HOST = 'io.github.cjiewong.tabbridge';
let port; let connected = false; let lastError = ''; let reconnectTimer; let retryDelay = 500;
let settings = { enabled: false, allowAllTabs: false, allowNewTabs: false, developer: false, quiet: true, focusEmulation: false };
let interactionRevision = 0;
function checkQuiet(method) {
  if (settings.quiet && ['activate', 'evaluate'].includes(method)) fail('QUIET_MODE', 'Do not disturb is enabled. Foreground activation and arbitrary JavaScript are blocked. Continue in the background or report the blocker; only the user can change this setting in the popup');
}
let leases = {}; let blockedTabs = {}; const locks = new Map(); const activeRequests = new Map();
let uiNotification;
function notifyUI() {
  clearTimeout(uiNotification);
  uiNotification = setTimeout(() => {
    // Extension pages only; no page content or identifiers in the notification.
    chrome.runtime.sendMessage({ type: 'ui.changed' }).catch(() => {});
  }, 50);
}
const ready = Promise.all([chrome.storage.local.get('settings'), chrome.storage.session.get(['leases', 'blockedTabs'])]).then(([local, session]) => {
  settings = { ...settings, ...local.settings }; leases = session.leases || {}; blockedTabs = session.blockedTabs || {};
});
async function saveLeases() { await chrome.storage.session.set({ leases, blockedTabs }); updateBadge(); }
function allAccess(tabId) { return settings.allowAllTabs && !blockedTabs[tabId]; }
function isWebTab(tab) { try { webURL(tab.url); return true; } catch { return false; } }
function checkLease(tabId, session, url) {
  if (blockedTabs[tabId]) fail('TAB_BLOCKED', 'This tab is blocked in the TabBridge popup');
  return requireLease(leases[tabId], session, url, { allowAllTabs: allAccess(tabId) });
}
function observationDeadline(params, deadline) {
  const timeout = params.timeoutMs ?? 8000;
  if (!Number.isInteger(timeout) || timeout < 0 || timeout > 12000) fail('INVALID_PARAMS', 'timeoutMs must be 0–12000');
  return Math.min(deadline, Date.now() + timeout);
}
async function waitForWebTab(tabId, session, end, control) {
  for (;;) {
    if (control.cancelled) fail('CANCELLED', 'Client disconnected while waiting for navigation');
    if (!settings.enabled) fail('STOPPED', 'TabBridge was stopped');
    if (blockedTabs[tabId]) fail('TAB_BLOCKED', 'This tab is blocked in the TabBridge popup');
    const tab = await chrome.tabs.get(tabId);
    const lease = leases[tabId];
    if (!lease && !allAccess(tabId)) fail('TAB_NOT_GRANTED', 'Share this tab from the TabBridge popup first');
    if (lease && lease.session !== session) fail('SESSION_CONFLICT', lease.session ? 'This tab belongs to another session' : 'Claim the shared tab first');
    if (lease?.grant === 'all' && !allAccess(tabId)) fail('TAB_NOT_GRANTED', 'All-web-tabs access was disabled');
    const committed = isWebTab(tab);
    if (committed && !tab.pendingUrl) return tab;
    if (committed && (lease?.session || !allAccess(tabId))) checkLease(tabId, session, tab.url);
    const pending = committed ? webURL(tab.pendingUrl) : pendingWebURL(tab, lease, session, { allowAllTabs: allAccess(tabId) });
    if (!pending) { checkLease(tabId, session, tab.url); webURL(tab.url); }
    if (Date.now() >= end) fail('PAGE_LOADING', 'The HTTP(S) navigation has not committed yet. Inspect or retry this read; do not reopen the tab or replay a write');
    await new Promise(resolve => setTimeout(resolve, Math.min(50, end - Date.now())));
  }
}
function updateBadge() {
  chrome.action.setBadgeText({ text: connected ? settings.allowAllTabs ? 'ALL' : String(Object.keys(leases).length || '') : settings.enabled ? '!' : '' });
  chrome.action.setBadgeBackgroundColor({ color: connected ? '#16705b' : '#b65521' });
  notifyUI();
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
  if (method === 'status') return { connected, version: chrome.runtime.getManifest().version, protocol: 1, allowAllTabs: settings.allowAllTabs, allowNewTabs: settings.allowNewTabs, developer: settings.developer && !settings.quiet, quiet: settings.quiet, focusEmulation: settings.quiet && settings.focusEmulation, session };
  checkQuiet(method);
  const revision = interactionRevision;
  const checkInteraction = () => {
    if (revision !== interactionRevision) fail('CANCELLED', 'Interaction settings changed during this request; inspect state before continuing');
    checkQuiet(method);
  };
  if (method === 'tabs') {
    const result = [];
    const candidates = settings.allowAllTabs ? await chrome.tabs.query({}) : (await Promise.all(Object.keys(leases).map(id => chrome.tabs.get(Number(id)).catch(() => null)))).filter(Boolean);
    for (const tab of candidates) {
      const lease = leases[tab.id];
      if (blockedTabs[tab.id] || (lease?.session && lease.session !== session)) continue;
      let pending;
      try { pending = !isWebTab(tab) && lease?.owned && lease.openingUrl ? pendingWebURL(tab, lease, session) : null; } catch { continue; }
      if (!isWebTab(tab) && !pending) continue;
      if (lease?.grant === 'all' && !allAccess(tab.id)) continue;
      if (!lease && !allAccess(tab.id)) continue;
      result.push({ tabId: tab.id, title: tab.title, url: pending?.href || tab.url, committed: !pending, loading: !!pending || tab.status === 'loading', discarded: !!tab.discarded, frozen: !!tab.frozen, active: tab.active, owned: !!lease?.owned, claimed: !!lease?.session, access: lease?.owned ? 'created' : allAccess(tab.id) ? 'all' : 'shared' });
    }
    return { tabs: result };
  }
  if (method === 'open') {
    if (!settings.allowNewTabs) fail('NEW_TABS_DISABLED', 'Enable agent-created tabs in the TabBridge popup');
    const url = webURL(params.url).href;
    let windowId;
    if (settings.quiet) {
      const window = await chrome.windows.getLastFocused({ windowTypes: ['normal'] }).catch(() => null);
      if (!window) fail('QUIET_MODE', 'No existing normal Chrome window is available. Do not disturb will not create a foreground window; open a window manually first');
      windowId = window.id;
    }
    checkInteraction();
    if (!settings.enabled || !settings.allowNewTabs) fail('NEW_TABS_DISABLED', 'Creating tabs was disabled');
    const tab = await chrome.tabs.create({ url, active: false, ...(windowId !== undefined ? { windowId } : {}) });
    leases[tab.id] = { owned: true, session, origin: new URL(url).origin, ...(!isWebTab(tab) ? { openingUrl: url } : {}) }; await saveLeases();
    return { tabId: tab.id, url, owned: true, loading: !isWebTab(tab) || tab.status === 'loading' };
  }
  const tabId = requireTabId(params.tabId);
  const observing = ['snapshot', 'read', 'screenshot', 'wait'].includes(method);
  const end = observing || (method === 'activate' && params.waitForText !== undefined) ? observationDeadline(params, deadline) : undefined;
  if (method === 'activate' && params.waitForText !== undefined && (typeof params.waitForText !== 'string' || params.waitForText.length > 1000)) fail('INVALID_PARAMS', 'waitForText must be text up to 1000 characters');
  const tab = observing || end !== undefined ? await waitForWebTab(tabId, session, end, control) : await chrome.tabs.get(tabId); let lease = leases[tabId];
  if (blockedTabs[tabId]) fail('TAB_BLOCKED', 'This tab is blocked in the TabBridge popup');
  if (isWebTab(tab) && lease?.openingUrl) { delete lease.openingUrl; await saveLeases(); }
  const initialCleanup = ['release', 'close'].includes(method) && lease?.owned && pendingWebURL(tab, lease, session);
  if (allAccess(tabId) && (!lease || !lease.session)) {
    const origin = webURL(tab.url).origin;
    lease = lease || { owned: false, origin, grant: 'all' };
    lease.session = session; leases[tabId] = lease; await saveLeases();
  }
  if (method === 'claim') {
    if (!lease) fail('TAB_NOT_GRANTED', 'Share this tab from the extension popup');
    if (lease.session && lease.session !== session) fail('SESSION_CONFLICT', 'Tab is claimed by another session');
    if (!lease.owned && !allAccess(tabId) && webURL(tab.url).origin !== lease.origin) fail('ORIGIN_CHANGED', 'Share this tab again after its origin changed');
    lease.session = session; await saveLeases(); checkLease(tabId, session, tab.url); return { tabId, title: tab.title, url: tab.url };
  }
  checkLease(tabId, session, initialCleanup?.href || tab.url);
  checkInteraction();
  const context = { deadline, control, observationDeadline: end, checkInteraction, authorize: url => { if (!settings.enabled) fail('STOPPED', 'TabBridge was stopped'); return checkLease(tabId, session, url); } };
  if (method === 'activate') {
    const window = await chrome.windows.get(tab.windowId);
    if (!settings.enabled) fail('STOPPED', 'TabBridge was stopped');
    checkLease(tabId, session, (await chrome.tabs.get(tabId)).url);
    checkInteraction();
    await chrome.tabs.update(tabId, { active: true });
    if (!settings.enabled) fail('STOPPED', 'TabBridge was stopped');
    checkLease(tabId, session, (await chrome.tabs.get(tabId)).url);
    checkInteraction();
    await chrome.windows.update(tab.windowId, { focused: true, ...(window.state === 'minimized' ? { state: 'normal' } : {}) });
    const [currentTab, currentWindow] = await Promise.all([chrome.tabs.get(tabId), chrome.windows.get(tab.windowId)]);
    const result = { tabId, windowId: currentTab.windowId, active: currentTab.active, windowFocused: currentWindow.focused, windowState: currentWindow.state };
    if (params.waitForText !== undefined) {
      await waitForWebTab(tabId, session, end, control);
      result.wait = await runAction('wait', tabId, { text: params.waitForText, timeoutMs: params.timeoutMs }, settings, context);
    }
    return result;
  }
  if (method === 'release') {
    await detach(tabId);
    if (lease.owned || lease.grant === 'all') delete leases[tabId]; else lease.session = null;
    await saveLeases(); return { released: tabId, tabKeptOpen: true };
  }
  if (method === 'close') {
    if (!lease.owned && !allAccess(tabId)) fail('USER_TAB', 'Enable All web tabs to close a user-owned tab, or release it instead');
    const current = await chrome.tabs.get(tabId);
    checkInteraction();
    if (settings.quiet && current.active) fail('QUIET_MODE', 'Closing the selected tab would select a different tab. Keep it open and release control while Do not disturb is enabled');
    await chrome.tabs.remove(tabId); delete leases[tabId]; await saveLeases(); return { closed: tabId };
  }
  if (method === 'batch') {
    if (!Array.isArray(params.steps) || params.steps.length < 1 || params.steps.length > 12) fail('INVALID_PARAMS', 'batch requires 1–12 steps');
    const allowed = new Set(['click', 'hover', 'drag', 'fill', 'press', 'select', 'scroll', 'wait']);
    // Validate the entire batch before doing anything.
    for (const step of params.steps) if (!step || !allowed.has(step.method) || !step.params || typeof step.params !== 'object' || Array.isArray(step.params) || 'tabId' in step.params) fail('INVALID_PARAMS', 'Invalid batch step');
    const results = [];
    for (const step of params.steps) {
      if (control.cancelled) return { completed: results.length, results, failed: { code: 'CANCELLED', message: 'Client disconnected' }, outcome: 'partial; do not replay completed steps' };
      if (Date.now() >= deadline) return { completed: results.length, results, failed: { code: 'EXPIRED', message: 'Batch deadline reached' }, outcome: 'partial; do not replay completed steps' };
      try {
        if (!settings.enabled) fail('STOPPED', 'TabBridge was stopped');
        checkLease(tabId, session, (await chrome.tabs.get(tabId)).url);
        results.push(await runAction(step.method, tabId, step.params, settings, { ...context, observationDeadline: undefined }));
      }
      catch (e) { return { completed: results.length, results, failed: { code: e.code || 'BROWSER_ERROR', message: e.message }, outcome: 'partial; do not replay completed steps' }; }
    }
    if (!settings.enabled) fail('STOPPED', 'TabBridge was stopped');
    checkLease(tabId, session, (await chrome.tabs.get(tabId)).url);
    return { completed: results.length, results, snapshot: await runAction('snapshot', tabId, {}, settings, context) };
  }
  if (method === 'navigate' && !lease.owned && !allAccess(tabId) && webURL(params.url).origin !== lease.origin) fail('ORIGIN_CHANGED', 'Shared tabs may only navigate within the granted origin. Create a new tab instead');
  return runAction(method, tabId, params, settings, context);
}

chrome.tabs.onActivated.addListener(notifyUI);
chrome.tabs.onCreated.addListener(notifyUI);
chrome.windows.onFocusChanged.addListener(notifyUI);
chrome.tabs.onRemoved.addListener(tabId => { delete leases[tabId]; delete blockedTabs[tabId]; detach(tabId); saveLeases(); });
chrome.tabs.onUpdated.addListener(async (tabId, change) => {
  await ready;
  if (change.url || change.title) notifyUI();
  if (!change.url) return;
  invalidate(tabId); const lease = leases[tabId];
  if (!lease) return;
  let clearedOpening = false;
  if (lease.openingUrl) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) return;
    try { if (pendingWebURL(tab, lease, lease.session)) return; } catch {}
    delete lease.openingUrl;
    clearedOpening = true;
  }
  let allowed = false; try { const url = webURL(change.url); allowed = lease.owned || allAccess(tabId) || url.origin === lease.origin; } catch {}
  if (!allowed) { delete leases[tabId]; await detach(tabId); await saveLeases(); }
  else if (clearedOpening) await saveLeases();
});
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Only our own extension pages can change access, never a website/content script.
  if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL(''))) return false;
  if (message.type === 'ui.changed') return false;
  (async () => {
    await ready;
    switch (message.type) {
      case 'ui.status': return { connected, lastError, settings, leases, blockedTabs };
      case 'ui.tabs': {
        const [tabs, window] = await Promise.all([chrome.tabs.query({}), chrome.windows.getLastFocused().catch(() => null)]);
        return { tabs: tabs.filter(isWebTab).map(t => ({ id: t.id, title: t.title, url: t.url, current: t.active && t.windowId === window?.id })) };
      }
      case 'ui.connect': settings.enabled = true; await chrome.storage.local.set({ settings }); connect(); return { ok: true };
      case 'ui.settings': return serial('ui:settings', async () => {
        const wasAll = settings.allowAllTabs;
        const wasQuiet = settings.quiet; const wasEmulated = settings.focusEmulation;
        for (const key of ['allowAllTabs', 'allowNewTabs', 'developer', 'quiet', 'focusEmulation']) if (typeof message[key] === 'boolean') settings[key] = message[key];
        if (!settings.quiet) settings.focusEmulation = false;
        if (wasQuiet !== settings.quiet || wasEmulated !== settings.focusEmulation) {
          interactionRevision++;
          await resetBrowserSessions();
        }
        await chrome.storage.local.set({ settings });
        if (wasAll && !settings.allowAllTabs) {
          for (const [id, lease] of Object.entries(leases)) {
            if (lease.owned) continue;
            let revoked = lease.grant === 'all';
            try { revoked ||= webURL((await chrome.tabs.get(Number(id))).url).origin !== lease.origin; } catch { revoked = true; }
            if (revoked) { delete leases[id]; await detach(Number(id)); }
          }
        }
        await saveLeases(); return { ok: true };
      });
      case 'ui.grant': {
        const tab = await chrome.tabs.get(requireTabId(message.tabId));
        if (leases[tab.id]?.session) fail('SESSION_CONFLICT', 'Revoke the existing session before sharing this tab again');
        const origin = webURL(tab.url).origin; delete blockedTabs[tab.id];
        if (!settings.allowAllTabs) leases[tab.id] = { owned: false, session: null, origin };
        await saveLeases(); return { ok: true };
      }
      case 'ui.revoke': {
        const tabId = requireTabId(message.tabId);
        delete leases[tabId]; if (settings.allowAllTabs) blockedTabs[tabId] = true;
        await detach(tabId); await saveLeases(); return { ok: true };
      }
      case 'ui.stop': {
        settings.enabled = false; settings.allowAllTabs = false; settings.allowNewTabs = false; settings.developer = false;
        await chrome.storage.local.set({ settings });
        for (const id of Object.keys(leases)) await detach(Number(id));
        leases = {}; blockedTabs = {}; await saveLeases(); clearTimeout(reconnectTimer);
        port?.disconnect(); port = null; connected = false; updateBadge(); return { ok: true };
      }
      default: fail('INVALID_METHOD', 'Unknown UI action');
    }
  })().then(sendResponse).catch(e => sendResponse({ error: e.message, code: e.code || 'BROWSER_ERROR' }));
  return true;
});
chrome.alarms.create('reconnect', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener(() => { if (!port) connect(); });
ready.then(() => { updateBadge(); connect(); });
