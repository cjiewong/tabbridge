import { fail } from './policy.js';

const captures = new Map();
const LIMIT = 100;

function requestURL(raw) {
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    return { url: `${url.origin}${url.pathname}`.slice(0, 2000), queryRedacted: !!url.search };
  } catch { return null; }
}
export function clearNetwork(tabId) { captures.delete(tabId); }

export function recordNetwork(tabId, method, params) {
  const capture = captures.get(tabId);
  if (!capture?.recording || typeof params.requestId !== 'string') return;
  if (method === 'Network.requestWillBeSent') {
    const url = requestURL(params.request?.url);
    if (!url) return;
    const previous = capture.requests.get(params.requestId);
    capture.requests.set(params.requestId, {
      requestId: params.requestId.slice(0, 100), ...url,
      method: String(params.request.method || '').slice(0, 20),
      type: String(params.type || '').slice(0, 40),
      ...(params.redirectResponse ? { redirected: true, previousStatus: params.redirectResponse.status } : {}),
      ...(previous?.redirected ? { redirected: true } : {})
    });
    while (capture.requests.size > LIMIT) capture.requests.delete(capture.requests.keys().next().value);
  } else {
    const record = capture.requests.get(params.requestId); if (!record) return;
    if (method === 'Network.responseReceived') {
      record.status = params.response.status;
      record.mimeType = String(params.response.mimeType || '').slice(0, 100);
    } else if (method === 'Network.loadingFinished') {
      record.completed = true; record.encodedDataLength = params.encodedDataLength;
    } else if (method === 'Network.loadingFailed') {
      record.completed = true; record.failed = true;
      record.error = String(params.errorText || '').slice(0, 200);
    }
  }
}

export async function network(tabId, { action = 'read' }, send) {
  if (!['start', 'read', 'stop'].includes(action)) fail('INVALID_PARAMS', 'network action must be start, read or stop');
  let capture = captures.get(tabId);
  if (action === 'start' && !capture?.recording) {
    capture = { recording: true, requests: new Map() }; captures.set(tabId, capture);
    try { await send(tabId, 'Network.enable'); }
    catch (error) { clearNetwork(tabId); throw error; }
  }
  if (action === 'stop' && capture?.recording) {
    await send(tabId, 'Network.disable'); capture.recording = false;
  }
  return { recording: !!capture?.recording, limit: LIMIT, requests: [...(capture?.requests.values() || [])] };
}
