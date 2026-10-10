export class BridgeError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
export function fail(code, message) { throw new BridgeError(code, message); }
export function webURL(raw) {
  let url; try { url = new URL(raw); } catch { fail('INVALID_URL', 'A complete http:// or https:// URL is required'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) fail('INVALID_URL', 'Only HTTP(S) URLs without embedded credentials are allowed');
  return url;
}
export function requireTabId(value) {
  if (!Number.isInteger(value) || value < 0) fail('INVALID_PARAMS', 'tabId must be a nonnegative integer');
  return value;
}
export function validSession(value) { return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(value); }
export function requireLease(lease, session, url, { allowAllTabs = false } = {}) {
  if (!lease) fail('TAB_NOT_GRANTED', 'Share this tab from the TabBridge popup first');
  if (lease.grant === 'all' && !allowAllTabs) fail('TAB_NOT_GRANTED', 'All-web-tabs access was disabled. Share this tab explicitly');
  if (lease.session !== session) fail('SESSION_CONFLICT', lease.session ? 'This tab belongs to another session' : 'Claim the shared tab first');
  const current = webURL(url);
  if (!lease.owned && !allowAllTabs && current.origin !== lease.origin) fail('ORIGIN_CHANGED', 'This shared tab changed origin. Share it again from the popup');
  return current;
}

// Permission to wait for navigation metadata, never to inspect about:blank.
export function pendingWebURL(tab, lease, session, { allowAllTabs = false } = {}) {
  if (tab.url && tab.url !== 'about:blank') return null;
  if (lease?.session && lease.session !== session) fail('SESSION_CONFLICT', 'This tab belongs to another session');
  if (lease?.owned && lease.openingUrl) {
    requireLease(lease, session, lease.openingUrl);
    return webURL(tab.pendingUrl || lease.openingUrl);
  }
  return allowAllTabs && tab.pendingUrl ? webURL(tab.pendingUrl) : null;
}
