import { fail, webURL } from './policy.js';

const attachments = new Map();
export const events = new Map();
export const dialogs = new Map();
export const snapshots = new Map();
const refs = new Map();
let generation = 0;

export function invalidate(tabId) { snapshots.delete(tabId); refs.delete(tabId); }
export async function detach(tabId) {
  attachments.delete(tabId); invalidate(tabId); events.delete(tabId); dialogs.delete(tabId);
  try { await chrome.debugger.detach({ tabId }); } catch {}
}
chrome.debugger.onDetach.addListener(source => { attachments.delete(source.tabId); invalidate(source.tabId); });
chrome.debugger.onEvent.addListener((source, method, params) => {
  if (method === 'Page.javascriptDialogOpening') dialogs.set(source.tabId, { type: params.type, message: params.message, defaultPrompt: params.defaultPrompt });
  if (method === 'Page.javascriptDialogClosed') dialogs.delete(source.tabId);
  if (method === 'Page.frameNavigated' && !params.frame?.parentId) invalidate(source.tabId);
  if (method === 'Runtime.consoleAPICalled' || method === 'Runtime.exceptionThrown') {
    const list = events.get(source.tabId) || [];
    list.push({ type: params.type || 'exception', message: (params.args || []).map(a => a.value ?? a.description ?? a.type).join(' ').slice(0, 2000) || params.exceptionDetails?.text || '', time: Date.now() });
    events.set(source.tabId, list.slice(-100));
  }
});

export async function cdp(tabId, method, params = {}) {
  if (!attachments.has(tabId)) {
    const pending = (async () => {
      try { await chrome.debugger.attach({ tabId }, '1.3'); }
      catch (e) { fail('ATTACH_FAILED', `Cannot attach to this tab: ${e.message}`); }
      await chrome.debugger.sendCommand({ tabId }, 'Page.enable');
      await chrome.debugger.sendCommand({ tabId }, 'Runtime.enable');
    })();
    attachments.set(tabId, pending);
    try { await pending; } catch (e) { attachments.delete(tabId); throw e; }
  }
  await attachments.get(tabId);
  return chrome.debugger.sendCommand({ tabId }, method, params);
}

async function objectFor(tabId, ref) {
  const record = refs.get(tabId)?.get(ref);
  if (!record) fail('STALE_REF', 'Element reference is missing or stale. Get a new snapshot');
  try {
    const result = await cdp(tabId, 'DOM.resolveNode', { backendNodeId: record.backendNodeId });
    if (!result.object?.objectId) fail('STALE_REF', 'Element no longer exists');
    return result.object.objectId;
  } catch { fail('STALE_REF', 'Element no longer exists. Get a new snapshot'); }
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
  return { tabId, url: tab.url, title: tab.title, snapshotId: id, truncated, ...(changes ? { changes, refs: rows.filter(r => r.ref && !/^\s*(StaticText|RootWebArea)/.test(r.text)) } : { text: full }) };
}

export async function click(tabId, { ref }) {
  await elementCall(tabId, ref, function () { if (this.disabled || this.getAttribute('aria-disabled') === 'true') throw new Error('Element is disabled'); this.scrollIntoView({ block: 'center', inline: 'center' }); });
  const record = refs.get(tabId).get(ref);
  const { quads } = await cdp(tabId, 'DOM.getContentQuads', { backendNodeId: record.backendNodeId });
  if (!quads?.length) fail('NOT_VISIBLE', 'Element has no visible box');
  const q = quads[0]; const x = (q[0] + q[2] + q[4] + q[6]) / 4; const y = (q[1] + q[3] + q[5] + q[7]) / 4;
  const hittable = await elementCall(tabId, ref, function () {
    const r = this.getBoundingClientRect(); const el = this.ownerDocument.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return !!el && (el === this || this.contains(el));
  });
  if (!hittable) fail('OBSCURED', 'Element is covered. Inspect the page before clicking');
  await cdp(tabId, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await cdp(tabId, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  return { clicked: ref };
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
  const keys = { Enter: [13, 'Enter'], Tab: [9, 'Tab'], Escape: [27, 'Escape'], Backspace: [8, 'Backspace'], Delete: [46, 'Delete'], ArrowDown: [40, 'ArrowDown'], ArrowUp: [38, 'ArrowUp'], ArrowLeft: [37, 'ArrowLeft'], ArrowRight: [39, 'ArrowRight'], Space: [32, ' '] };
  if (!keys[key]) fail('INVALID_PARAMS', `Supported keys: ${Object.keys(keys).join(', ')}`);
  const [code, name] = keys[key];
  await cdp(tabId, 'Input.dispatchKeyEvent', { type: 'keyDown', key: name, code: key, windowsVirtualKeyCode: code, ...(key === 'Enter' ? { text: '\r' } : key === 'Space' ? { text: ' ' } : {}) });
  await cdp(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', key: name, code: key, windowsVirtualKeyCode: code }); return { pressed: key };
}
export async function select(tabId, { ref, value }) {
  if (typeof value !== 'string') fail('INVALID_PARAMS', 'value must be a string');
  await elementCall(tabId, ref, function (value) {
    if (this.tagName !== 'SELECT' || this.disabled) throw new Error('Element is not an enabled select');
    if (![...this.options].some(o => o.value === value && !o.disabled)) throw new Error('Option does not exist or is disabled');
    this.value = value; this.dispatchEvent(new Event('input', { bubbles: true })); this.dispatchEvent(new Event('change', { bubbles: true }));
  }, [value]); return { selected: value };
}

export async function runAction(method, tabId, params, settings) {
  switch (method) {
    case 'snapshot': return snapshot(tabId, params);
    case 'click': return click(tabId, params);
    case 'fill': return fill(tabId, params);
    case 'press': return press(tabId, params);
    case 'select': return select(tabId, params);
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
      await cdp(tabId, 'Input.dispatchMouseEvent', { type: 'mouseWheel', x: 200, y: 200, deltaX: 0, deltaY }); return { scrolled: deltaY };
    }
    case 'screenshot': {
      const result = await cdp(tabId, 'Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      if (result.data.length > 7_000_000) fail('IMAGE_TOO_LARGE', 'Screenshot is too large. Reduce the browser window size');
      return { mimeType: 'image/png', data: result.data };
    }
    case 'wait': {
      const timeout = params.timeoutMs ?? 8000;
      if (!Number.isInteger(timeout) || timeout < 0 || timeout > 12000 || typeof params.text !== 'string' || params.text.length > 1000) fail('INVALID_PARAMS', 'wait requires text and timeoutMs from 0–12000');
      const deadline = Date.now() + timeout;
      do {
        const result = await cdp(tabId, 'Runtime.evaluate', { expression: `Boolean(document.body && document.body.innerText.includes(${JSON.stringify(params.text)}))`, returnByValue: true });
        if (result.result.value) return { found: true };
        await new Promise(r => setTimeout(r, 100));
      } while (Date.now() < deadline);
      fail('WAIT_TIMEOUT', 'Text did not appear'); break;
    }
    case 'dialog': {
      if (params.accept === undefined) return { dialog: dialogs.get(tabId) || null };
      if (typeof params.accept !== 'boolean' || (params.promptText !== undefined && typeof params.promptText !== 'string')) fail('INVALID_PARAMS', 'accept must be boolean; promptText must be text');
      await cdp(tabId, 'Page.handleJavaScriptDialog', { accept: params.accept, ...(params.promptText !== undefined ? { promptText: params.promptText } : {}) }); return { handled: true };
    }
    case 'logs': return { logs: events.get(tabId) || [] };
    case 'evaluate': {
      if (!settings.developer) fail('DEVELOPER_DISABLED', 'Enable JavaScript evaluation in the extension popup first');
      if (typeof params.expression !== 'string' || params.expression.length > 20000) fail('INVALID_PARAMS', 'expression must be a string up to 20,000 characters');
      const result = await cdp(tabId, 'Runtime.evaluate', { expression: params.expression, returnByValue: true, awaitPromise: true, timeout: 5000 });
      if (result.exceptionDetails) fail('JAVASCRIPT_ERROR', result.exceptionDetails.text);
      return { value: result.result.value, description: result.result.description };
    }
    default: fail('INVALID_METHOD', `Unknown action: ${method}`);
  }
}
