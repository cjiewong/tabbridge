import { fail, webURL } from './policy.js';
import { keyEvent } from './keys.js';
import { network, recordNetwork, clearNetwork } from './network.js';

const attachments = new Map();
const emulatedFocus = new Set();
const actionScopes = new Map();
export const events = new Map();
export const dialogs = new Map();
export const snapshots = new Map();
const refs = new Map();
let generation = 0;
const dragListeners = new Map();

export function invalidate(tabId) { snapshots.delete(tabId); refs.delete(tabId); }
export async function detach(tabId) {
  if (actionScopes.has(tabId)) actionScopes.get(tabId).active = false;
  attachments.delete(tabId); emulatedFocus.delete(tabId); invalidate(tabId); events.delete(tabId); dialogs.delete(tabId);
  clearNetwork(tabId); dragListeners.get(tabId)?.(null); dragListeners.delete(tabId);
  try { await chrome.debugger.detach({ tabId }); } catch {}
}
export async function resetBrowserSessions() {
  const ids = new Set([...attachments.keys(), ...actionScopes.keys(), ...emulatedFocus]);
  // Invalidate all scopes synchronously before awaiting any detach.
  for (const scope of actionScopes.values()) scope.active = false;
  await Promise.all([...ids].map(detach));
}
chrome.debugger.onDetach.addListener(source => {
  if (actionScopes.has(source.tabId)) actionScopes.get(source.tabId).active = false;
  attachments.delete(source.tabId); emulatedFocus.delete(source.tabId); invalidate(source.tabId); clearNetwork(source.tabId); dragListeners.get(source.tabId)?.(null);
});
chrome.debugger.onEvent.addListener((source, method, params) => {
  if (method.startsWith('Network.')) recordNetwork(source.tabId, method, params);
  if (method === 'Input.dragIntercepted') dragListeners.get(source.tabId)?.(params.data);
  if (method === 'Page.javascriptDialogOpening') dialogs.set(source.tabId, { type: params.type, message: params.message, defaultPrompt: params.defaultPrompt });
  if (method === 'Page.javascriptDialogClosed') dialogs.delete(source.tabId);
  if (method === 'Page.frameNavigated' && !params.frame?.parentId) invalidate(source.tabId);
  if (method === 'Runtime.consoleAPICalled' || method === 'Runtime.exceptionThrown') {
    const list = events.get(source.tabId) || [];
    list.push({ type: params.type || 'exception', message: (params.args || []).map(a => a.value ?? a.description ?? a.type).join(' ').slice(0, 2000) || params.exceptionDetails?.text || '', time: Date.now() });
    events.set(source.tabId, list.slice(-100));
  }
});

function checkScope(scope) {
  if (scope && (!scope.active || scope.control?.cancelled)) fail('CANCELLED', 'Tab access, debugging or the client ended during this action; inspect before continuing');
  if (scope?.deadline && Date.now() >= scope.deadline) fail('EXPIRED', 'Request expired; no further browser command was dispatched');
  scope?.checkInteraction?.();
}
function authorizeDocument(scope, url) {
  checkScope(scope);
  try { scope?.authorize?.(url); }
  catch (error) {
    // Access can end before an asynchronous detach completes. An active
    // action is cancelled; a later request still receives its normal denial.
    if (['TAB_NOT_GRANTED', 'TAB_BLOCKED', 'SESSION_CONFLICT', 'ORIGIN_CHANGED', 'STOPPED', 'INVALID_URL'].includes(error.code)) {
      scope.active = false;
      fail('CANCELLED', 'Tab access or origin changed during this action; no further command was dispatched. Inspect before continuing');
    }
    throw error;
  }
  checkScope(scope);
}
async function authorizeCommand(tabId, scope) {
  checkScope(scope);
  if (scope?.authorize) {
    const tab = await chrome.tabs.get(tabId);
    checkScope(scope);
    authorizeDocument(scope, tab.url);
  }
  checkScope(scope);
}
export async function cdp(tabId, method, params = {}) {
  const scope = actionScopes.get(tabId);
  await authorizeCommand(tabId, scope);
  if (!attachments.has(tabId)) {
    const pending = (async () => {
      try { await chrome.debugger.attach({ tabId }, '1.3'); }
      catch (e) { fail('ATTACH_FAILED', `Cannot attach to this tab: ${e.message}`); }
      if ((scope && !scope.active) || attachments.get(tabId) !== pending) {
        await chrome.debugger.detach({ tabId }).catch(() => {});
        fail('CANCELLED', 'Tab access ended while attaching; no browser action was dispatched');
      }
      try { await authorizeCommand(tabId, scope); }
      catch (error) { await chrome.debugger.detach({ tabId }).catch(() => {}); throw error; }
      await chrome.debugger.sendCommand({ tabId }, 'Page.enable');
      await authorizeCommand(tabId, scope);
      await chrome.debugger.sendCommand({ tabId }, 'Runtime.enable');
      if (scope?.settings.quiet && scope.settings.focusEmulation) {
        await authorizeCommand(tabId, scope);
        try { await chrome.debugger.sendCommand({ tabId }, 'Emulation.setFocusEmulationEnabled', { enabled: true }); }
        catch (error) {
          await chrome.debugger.detach({ tabId }).catch(() => {});
          fail('FOCUS_EMULATION_UNAVAILABLE', `Background focus emulation failed; no foreground fallback was attempted: ${error.message}`);
        }
        try { await authorizeCommand(tabId, scope); }
        catch (error) { await chrome.debugger.detach({ tabId }).catch(() => {}); throw error; }
        emulatedFocus.add(tabId);
      }
    })();
    attachments.set(tabId, pending);
    try { await pending; } catch (e) { attachments.delete(tabId); throw e; }
  }
  await attachments.get(tabId);
  await authorizeCommand(tabId, scope);
  const result = await chrome.debugger.sendCommand({ tabId }, method, params);
  if (scope?.observing) await authorizeCommand(tabId, scope);
  return result;
}

const pageStateExpression = `({documentURL: location.href, readyState: document.readyState, domContentLoaded: document.readyState === 'complete' || (performance.getEntriesByType('navigation')[0]?.domContentLoadedEventEnd || 0) > 0, visibilityState: document.visibilityState, documentFocused: document.hasFocus()})`;
function pageState(tab, documentState) {
  const quiet = !!actionScopes.get(tab.id)?.settings.quiet;
  const focusEmulated = emulatedFocus.has(tab.id);
  return { loading: tab.status === 'loading', readyState: documentState.readyState, domContentLoaded: documentState.domContentLoaded, visibilityState: documentState.visibilityState, documentFocused: documentState.documentFocused, discarded: !!tab.discarded, frozen: !!tab.frozen, quiet, focusEmulated,
    ...(focusEmulated ? { renderHint: 'Document visibility/focus is emulated. It is not evidence of real window or macOS desktop focus. Verify expected application content' } : documentState.visibilityState === 'hidden' ? { renderHint: quiet ? 'Background rendering may be deferred. Do not disturb prohibits activation; wait for expected content or report the blocker. The user may enable background focus emulation in the popup' : 'Background pages may defer rendering. If expected content is missing, explicitly activate this authorized tab and wait for that content; do not repeat a write' } : {}) };
}
async function waitForDocument(tabId, scope) {
  for (;;) {
    checkScope(scope);
    const tab = await chrome.tabs.get(tabId);
    checkScope(scope);
    authorizeDocument(scope, tab.url);
    if (tab.discarded || tab.frozen) fail('FOREGROUND_REQUIRED', scope.settings.quiet ? 'This tab is discarded or frozen. Do not disturb prohibits foreground recovery. Report the blocker and let the user restore the tab manually' : 'This tab is discarded or frozen. Explicitly activate the authorized tab, then wait for the expected content');
    let state;
    try {
      const result = await cdp(tabId, 'Runtime.evaluate', { expression: pageStateExpression, returnByValue: true });
      checkScope(scope);
      state = result.result?.value;
    } catch (error) {
      // Only retry this read of lifecycle metadata during a context transition.
      if (typeof error.code === 'string' || !/Execution context was destroyed|Cannot find context|Inspected target navigated/i.test(error.message)) throw error;
    }
    if (state?.documentURL && state.documentURL !== 'about:blank') {
      if (state.documentURL.startsWith('chrome-error:')) fail('NAVIGATION_FAILED', 'Chrome could not load this page. Inspect the navigation or network failure before retrying');
      authorizeDocument(scope, state.documentURL);
      if (state.domContentLoaded) return pageState(tab, state);
    }
    if (Date.now() >= scope.observationDeadline) fail('READINESS_TIMEOUT', scope.settings.quiet ? 'DOMContentLoaded did not finish in the background. Do not disturb prohibits foreground recovery; report the blocker or retry only the read' : 'DOMContentLoaded did not finish in time. Retry only the read, or explicitly activate a background tab if the task needs foreground rendering');
    await new Promise(resolve => setTimeout(resolve, Math.min(50, scope.observationDeadline - Date.now())));
  }
}

async function objectFor(tabId, ref) {
  const record = refs.get(tabId)?.get(ref);
  if (!record) fail('STALE_REF', 'Element reference is missing or stale. Get a new snapshot');
  try {
    const result = await cdp(tabId, 'DOM.resolveNode', { backendNodeId: record.backendNodeId });
    if (!result.object?.objectId) fail('STALE_REF', 'Element no longer exists');
    return result.object.objectId;
  } catch (error) {
    if (['CANCELLED', 'EXPIRED'].includes(error.code)) throw error;
    fail('STALE_REF', 'Element no longer exists. Get a new snapshot');
  }
}
async function elementCall(tabId, ref, fn, args = []) {
  const objectId = await objectFor(tabId, ref);
  try {
    const result = await cdp(tabId, 'Runtime.callFunctionOn', { objectId, functionDeclaration: fn.toString(), arguments: args.map(value => ({ value })), returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) fail('ELEMENT_ERROR', result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  } finally { await cdp(tabId, 'Runtime.releaseObject', { objectId }).catch(() => {}); }
}

export async function snapshot(tabId, { diff = false, maxNodes = 300 } = {}) {
  if (!Number.isInteger(maxNodes) || maxNodes < 1 || maxNodes > 1000) fail('INVALID_PARAMS', 'maxNodes must be 1–1000');
  const tab = await chrome.tabs.get(tabId);
  const window = await chrome.windows.get(tab.windowId);
  const tree = await cdp(tabId, 'Accessibility.getFullAXTree');
  const currentRefs = new Map(); const rows = []; const id = `s${++generation}`;
  const byId = new Map(tree.nodes.map(n => [n.nodeId, n]));
  const previous = snapshots.get(tabId); let truncated = false; let chars = 0;
  function walk(nodeId, depth) {
    const node = byId.get(nodeId); if (!node) return;
    const role = node.role?.value || ''; const name = String(node.name?.value || '').replace(/\s+/g, ' ').trim();
    const ignored = node.ignored || ['none', 'generic', 'InlineTextBox'].includes(role);
    if (!ignored && (name || !['StaticText', 'text'].includes(role))) {
      if (rows.length >= maxNodes || chars >= 32000) { truncated = true; return; }
      const ref = node.backendDOMNodeId ? `${id}:e${rows.length + 1}` : null;
      if (ref) currentRefs.set(ref, { backendNodeId: node.backendDOMNodeId });
      const properties = Object.fromEntries((node.properties || []).filter(p => ['disabled', 'checked', 'selected', 'expanded', 'required', 'readonly', 'focused', 'protected'].includes(p.name)).map(p => [p.name, p.value.value]));
      const value = properties.protected ? '[redacted]' : node.value?.value;
      const text = `${'  '.repeat(Math.min(depth, 12))}${role}${name ? ` ${JSON.stringify(name.slice(0, 1200))}` : ''}${value !== undefined ? ` value=${JSON.stringify(String(value).slice(0, 500))}` : ''}${Object.keys(properties).length ? ` ${JSON.stringify(properties)}` : ''}`;
      rows.push({ ref, text }); chars += text.length;
    }
    for (const child of node.childIds || []) walk(child, depth + (ignored ? 0 : 1));
  }
  if (tree.nodes.length) walk(tree.nodes[0].nodeId, 0);
  refs.set(tabId, currentRefs);
  const full = rows.map(r => `${r.ref ? `[${r.ref}] ` : ''}${r.text}`).join('\n');
  const oldTexts = new Set(previous?.rows.map(r => r.text) || []);
  const newTexts = new Set(rows.map(r => r.text));
  const changes = diff && previous ? { added: rows.filter(r => !oldTexts.has(r.text)).map(r => `${r.ref ? `[${r.ref}] ` : ''}${r.text}`), removed: previous.rows.filter(r => !newTexts.has(r.text)).map(r => r.text) } : undefined;
  snapshots.set(tabId, { rows });
  // Diff refs must remain usable: include the current interactive reference map.
  return { tabId, url: tab.url, title: tab.title, active: tab.active, windowFocused: window.focused, ...actionScopes.get(tabId)?.pageState, snapshotId: id, truncated, ...(changes ? { changes, refs: rows.filter(r => r.ref && !/^\s*(StaticText|RootWebArea)/.test(r.text)) } : { text: full }) };
}

async function pointFor(tabId, ref, { enabled = false, scroll = true } = {}) {
  await elementCall(tabId, ref, function (enabled, scroll) {
    if (enabled && (this.disabled || this.getAttribute('aria-disabled') === 'true')) throw new Error('Element is disabled');
    if (scroll) this.scrollIntoView({ block: 'center', inline: 'center' });
  }, [enabled, scroll]);
  const record = refs.get(tabId).get(ref);
  const { quads } = await cdp(tabId, 'DOM.getContentQuads', { backendNodeId: record.backendNodeId });
  if (!quads?.length) fail('NOT_VISIBLE', 'Element has no visible box');
  const q = quads[0]; const x = (q[0] + q[2] + q[4] + q[6]) / 4; const y = (q[1] + q[3] + q[5] + q[7]) / 4;
  const hittable = await elementCall(tabId, ref, function () {
    const r = this.getBoundingClientRect(); const el = this.ownerDocument.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return !!el && (el === this || this.contains(el));
  });
  if (!hittable) fail('OBSCURED', 'Element is covered. Inspect the page before clicking');
  return { x, y };
}

export async function click(tabId, { ref }) {
  const { x, y } = await pointFor(tabId, ref, { enabled: true });
  await cdp(tabId, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await cdp(tabId, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  return { clicked: ref };
}

export async function hover(tabId, { ref }) {
  const point = await pointFor(tabId, ref);
  await cdp(tabId, 'Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
  return { hovered: ref };
}

export async function drag(tabId, { sourceRef, targetRef }) {
  const start = await pointFor(tabId, sourceRef, { enabled: true });
  const end = await pointFor(tabId, targetRef, { enabled: true, scroll: false });
  let resolveDrag; let timer; let pressed = false;
  const intercepted = new Promise(resolve => { resolveDrag = resolve; });
  dragListeners.set(tabId, resolveDrag);
  // Once attached, never reattach after a revoke/detach in the middle of a drag.
  const send = async (method, params) => {
    if (!actionScopes.get(tabId)?.active) fail('CANCELLED', 'Tab access ended during the drag; inspect the page before continuing');
    return chrome.debugger.sendCommand({ tabId }, method, params);
  };
  try {
    await cdp(tabId, 'Input.setInterceptDrags', { enabled: true });
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...start });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...start, button: 'left', buttons: 1, clickCount: 1 }); pressed = true;
    for (let step = 1; step <= 8; step++) {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: start.x + (end.x - start.x) * step / 8, y: start.y + (end.y - start.y) * step / 8, button: 'left', buttons: 1 });
    }
    const data = await Promise.race([intercepted, new Promise(resolve => { timer = setTimeout(() => resolve(null), 750); })]);
    if (data) {
      if (data.files?.length || JSON.stringify(data).length > 100000) fail('DRAG_DATA_LIMIT', 'File drags and oversized drag payloads are unsupported; use upload for files');
      for (const type of ['dragEnter', 'dragOver', 'drop']) await send('Input.dispatchDragEvent', { type, ...end, data });
    }
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...end, button: 'left', clickCount: 1 }); pressed = false;
    return { dragged: sourceRef, droppedOn: targetRef, kind: data ? 'html5' : 'pointer' };
  } finally {
    clearTimeout(timer); dragListeners.delete(tabId);
    if (pressed) await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...end, button: 'left', clickCount: 1 }).catch(() => {});
    await send('Input.setInterceptDrags', { enabled: false }).catch(() => {});
  }
}

export async function fill(tabId, { ref, text }) {
  if (typeof text !== 'string' || text.length > 100_000) fail('INVALID_PARAMS', 'text must be a string up to 100,000 characters');
  await elementCall(tabId, ref, function () {
    if (this.disabled || this.readOnly || this.type === 'file') throw new Error('Element is not an editable text field');
    if (!['INPUT', 'TEXTAREA'].includes(this.tagName) && !this.isContentEditable) throw new Error('Element is not editable');
    this.focus();
    if (this.isContentEditable) { const r = this.ownerDocument.createRange(); r.selectNodeContents(this); const s = this.ownerDocument.getSelection(); s.removeAllRanges(); s.addRange(r); }
    else this.select();
  });
  await cdp(tabId, 'Input.insertText', { text }); return { filled: ref, characters: text.length };
}
export async function press(tabId, { key }) {
  const { text, commands, ...event } = keyEvent(key);
  await cdp(tabId, 'Input.dispatchKeyEvent', { type: 'keyDown', ...event, ...(text !== undefined ? { text } : {}), ...(commands ? { commands } : {}) });
  await cdp(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', ...event }); return { pressed: key };
}
export async function select(tabId, { ref, value }) {
  if (typeof value !== 'string') fail('INVALID_PARAMS', 'value must be a string');
  await elementCall(tabId, ref, function (value) {
    if (this.tagName !== 'SELECT' || this.disabled) throw new Error('Element is not an enabled select');
    if (![...this.options].some(o => o.value === value && !o.disabled)) throw new Error('Option does not exist or is disabled');
    this.value = value; this.dispatchEvent(new Event('input', { bubbles: true })); this.dispatchEvent(new Event('change', { bubbles: true }));
  }, [value]); return { selected: value };
}

export async function runAction(method, tabId, params, settings, context = {}) {
  const observing = ['snapshot', 'read', 'screenshot', 'wait'].includes(method);
  const timeout = params.timeoutMs ?? 8000;
  if (observing && (!Number.isInteger(timeout) || timeout < 0 || timeout > 12000)) fail('INVALID_PARAMS', 'timeoutMs must be 0–12000');
  if (method === 'wait' && (typeof params.text !== 'string' || params.text.length > 1000)) fail('INVALID_PARAMS', 'wait requires text up to 1000 characters');
  const scope = { active: true, observing, settings, ...context, observationDeadline: context.observationDeadline ?? Math.min(context.deadline ?? Infinity, Date.now() + timeout) }; actionScopes.set(tabId, scope);
  try {
    if (observing) scope.pageState = await waitForDocument(tabId, scope);
    return await performAction(method, tabId, params, settings);
  }
  finally { if (actionScopes.get(tabId) === scope) actionScopes.delete(tabId); }
}

async function performAction(method, tabId, params, settings) {
  switch (method) {
    case 'snapshot': return snapshot(tabId, params);
    case 'read': {
      const maxChars = params.maxChars ?? 12000;
      if (!Number.isInteger(maxChars) || maxChars < 1 || maxChars > 32000) fail('INVALID_PARAMS', 'maxChars must be 1–32000');
      let content;
      if (params.ref !== undefined) {
        content = await elementCall(tabId, params.ref, function (limit) {
          if (!this.getClientRects().length || getComputedStyle(this).visibility !== 'visible') throw new Error('Element is not visible');
          const text = String(this.innerText || '');
          return { text: text.slice(0, limit), truncated: text.length > limit };
        }, [maxChars]);
      } else {
        const result = await cdp(tabId, 'Runtime.evaluate', { expression: `(() => { const text = document.body ? document.body.innerText : ''; return { text: text.slice(0, ${maxChars}), truncated: text.length > ${maxChars} }; })()`, returnByValue: true });
        content = result.result.value;
      }
      const tab = await chrome.tabs.get(tabId);
      return { tabId, url: tab.url, title: tab.title, ...actionScopes.get(tabId)?.pageState, ...content };
    }
    case 'click': return click(tabId, params);
    case 'hover': return hover(tabId, params);
    case 'drag': return drag(tabId, params);
    case 'fill': return fill(tabId, params);
    case 'press': return press(tabId, params);
    case 'select': return select(tabId, params);
    case 'upload': {
      if (!Array.isArray(params.files) || params.files.length > 16 || params.files.some(file => typeof file !== 'string' || !file.startsWith('/') || file.length > 4096 || file.includes('\0'))) fail('INVALID_PARAMS', 'files must be an array of up to 16 absolute local paths');
      await elementCall(tabId, params.ref, function (count) {
        if (this.tagName !== 'INPUT' || this.type !== 'file' || this.disabled) throw new Error('Element is not an enabled file input');
        if (!this.multiple && count > 1) throw new Error('This file input accepts only one file');
      }, [params.files.length]);
      const record = refs.get(tabId)?.get(params.ref);
      if (!record) fail('STALE_REF', 'Get a fresh snapshot before selecting files');
      if (params.files.length) {
        await cdp(tabId, 'DOM.setFileInputFiles', { backendNodeId: record.backendNodeId, files: params.files });
      } else {
        await elementCall(tabId, params.ref, function () {
          if (this.files.length) {
            this.value = '';
            this.dispatchEvent(new Event('input', { bubbles: true }));
            this.dispatchEvent(new Event('change', { bubbles: true }));
          }
        });
      }
      return { selectedFiles: params.files.length };
    }
    case 'network': return network(tabId, params, cdp);
    case 'navigate': {
      const url = webURL(params.url).href; invalidate(tabId);
      const result = await cdp(tabId, 'Page.navigate', { url });
      if (result.errorText) fail('NAVIGATION_FAILED', result.errorText);
      return { navigating: url };
    }
    case 'reload': invalidate(tabId); await cdp(tabId, 'Page.reload'); return { reloading: true };
    case 'back': case 'forward': {
      const h = await cdp(tabId, 'Page.getNavigationHistory'); const target = h.entries[h.currentIndex + (method === 'back' ? -1 : 1)];
      if (!target) fail('NO_HISTORY', `No ${method} entry`);
      webURL(target.url); invalidate(tabId); await cdp(tabId, 'Page.navigateToHistoryEntry', { entryId: target.id }); return { navigating: target.url };
    }
    case 'scroll': {
      const deltaY = params.deltaY ?? 600; if (!Number.isFinite(deltaY) || Math.abs(deltaY) > 10000) fail('INVALID_PARAMS', 'deltaY must be between -10000 and 10000');
      if (settings.quiet) {
        // A wheel acknowledgement may wait indefinitely on an unpainted
        // background surface. Scroll the document once, without window focus.
        const result = await cdp(tabId, 'Runtime.evaluate', { expression: `(() => { window.scrollBy({ top: ${deltaY}, behavior: 'instant' }); return { x: scrollX, y: scrollY }; })()`, returnByValue: true });
        return { scrolled: deltaY, position: result.result.value, target: 'document' };
      }
      await cdp(tabId, 'Input.dispatchMouseEvent', { type: 'mouseWheel', x: 200, y: 200, deltaX: 0, deltaY }); return { scrolled: deltaY };
    }
    case 'screenshot': {
      if (params.fullPage !== undefined && typeof params.fullPage !== 'boolean') fail('INVALID_PARAMS', 'fullPage must be boolean');
      if (params.fullPage && params.ref !== undefined) fail('INVALID_PARAMS', 'Choose fullPage or an element ref, not both');
      let clip;
      if (params.ref !== undefined) {
        clip = await elementCall(tabId, params.ref, function () {
          const box = this.getBoundingClientRect();
          if (!this.getClientRects().length || !box.width || !box.height) throw new Error('Element has no visible box');
          return { x: Math.max(0, box.x + window.scrollX), y: Math.max(0, box.y + window.scrollY), width: box.width, height: box.height, scale: 1 };
        });
      } else if (params.fullPage) {
        const metrics = await cdp(tabId, 'Page.getLayoutMetrics');
        const size = metrics.cssContentSize || metrics.contentSize;
        clip = { x: 0, y: 0, width: Math.ceil(size.width), height: Math.ceil(size.height), scale: 1 };
      }
      if (clip && (!Number.isFinite(clip.width * clip.height) || clip.width <= 0 || clip.height <= 0 || clip.width > 16384 || clip.height > 16384 || clip.width * clip.height > 32000000)) fail('IMAGE_TOO_LARGE', 'Capture a smaller element; screenshots are limited to 16,384 pixels per side and 32 million pixels');
      const result = await cdp(tabId, 'Page.captureScreenshot', { format: 'png', captureBeyondViewport: !!clip, ...(clip ? { clip } : {}) });
      if (result.data.length > 7_000_000) fail('IMAGE_TOO_LARGE', 'Screenshot is too large. Reduce the browser window size');
      return { mimeType: 'image/png', data: result.data };
    }
    case 'wait': {
      const scope = actionScopes.get(tabId);
      do {
        const result = await cdp(tabId, 'Runtime.evaluate', { expression: `({...${pageStateExpression}, found: Boolean(document.body && document.body.innerText.includes(${JSON.stringify(params.text)}))})`, returnByValue: true });
        const state = result.result?.value;
        if (state?.documentURL) authorizeDocument(scope, state.documentURL);
        if (state?.found) return { found: true, ...pageState(await chrome.tabs.get(tabId), state) };
        if (Date.now() >= scope.observationDeadline) break;
        await new Promise(r => setTimeout(r, Math.min(100, scope.observationDeadline - Date.now())));
      } while (Date.now() <= scope.observationDeadline);
      const state = await cdp(tabId, 'Runtime.evaluate', { expression: pageStateExpression, returnByValue: true });
      fail('WAIT_TIMEOUT', settings.quiet ? 'Expected content did not appear in the background. Do not disturb prohibits activation; report the blocker. Do not reload or replay a write to force progress' : state.result.value?.visibilityState === 'hidden' ? 'Text did not appear in this background tab. If the task requires it, explicitly activate this authorized tab and wait again; do not repeat a write' : 'Text did not appear; document readiness does not guarantee application content is ready'); break;
    }
    case 'dialog': {
      if (params.accept === undefined) return { dialog: dialogs.get(tabId) || null };
      if (typeof params.accept !== 'boolean' || (params.promptText !== undefined && typeof params.promptText !== 'string')) fail('INVALID_PARAMS', 'accept must be boolean; promptText must be text');
      await cdp(tabId, 'Page.handleJavaScriptDialog', { accept: params.accept, ...(params.promptText !== undefined ? { promptText: params.promptText } : {}) }); return { handled: true };
    }
    case 'logs': return { logs: events.get(tabId) || [] };
    case 'evaluate': {
      if (settings.quiet) fail('QUIET_MODE', 'Arbitrary JavaScript is blocked while Do not disturb is enabled');
      if (!settings.developer) fail('DEVELOPER_DISABLED', 'Enable JavaScript evaluation in the extension popup first');
      if (typeof params.expression !== 'string' || params.expression.length > 20000) fail('INVALID_PARAMS', 'expression must be a string up to 20,000 characters');
      const result = await cdp(tabId, 'Runtime.evaluate', { expression: params.expression, returnByValue: true, awaitPromise: true, timeout: 5000 });
      if (result.exceptionDetails) fail('JAVASCRIPT_ERROR', result.exceptionDetails.text);
      return { value: result.result.value, description: result.result.description };
    }
    default: fail('INVALID_METHOD', `Unknown action: ${method}`);
  }
}
