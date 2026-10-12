import { defaultLanguage, translator } from './popup-i18n.js';

const $ = id => document.getElementById(id);
const version = chrome.runtime.getManifest().version;
// Chrome may clamp an action popup below its requested 600px height.
// Fit after layout, keeping the footer inside the actual viewport.
function fitPopupHeight() { document.body.style.height = `${Math.min(600, window.innerHeight)}px`; }
window.addEventListener('resize', fitPopupHeight);
requestAnimationFrame(fitPopupHeight);
let language = defaultLanguage(chrome.i18n.getUILanguage());
let t = translator(language);
let state;
let tabs;
let renderGeneration = 0;
let stateGeneration = 0;
let listLoading = false;
let refreshQueued = false;
let refreshTimer;
let mutationCount = 0;
let stopping = false;
let actionError;
let languageChanged = false;

async function send(message) {
  const reply = await chrome.runtime.sendMessage(message);
  if (!reply || reply.error) throw Object.assign(new Error(reply?.error || t('actionFailed')), { code: reply?.code });
  return reply;
}
function showError() {
  const message = actionError ? actionError.code && t(actionError.code) !== actionError.code ? t(actionError.code) : actionError.message : state?.lastError || '';
  $('error').textContent = message;
  $('error').hidden = !message;
}
function applyLanguage() {
  t = translator(language);
  document.documentElement.lang = language;
  $('language').value = language;
  for (const element of document.querySelectorAll('[data-i18n]')) element.textContent = t(element.dataset.i18n);
  $('language').setAttribute('aria-label', t('language'));
  document.querySelector('.controls').setAttribute('aria-label', t('access'));
  $('search').setAttribute('aria-label', t('search'));
  $('search').placeholder = t('searchPlaceholder');
  $('filter').setAttribute('aria-label', t('filter'));
  $('new-tabs').title = t('newTabsHint');
  $('diagnostics-panel').setAttribute('aria-label', t('details'));
  $('status').textContent = t('checking');
  if (state) renderState(state);
  if (state && tabs) renderTabs();
  showError();
}
function connectionText() { return t(!state ? 'checking' : state.connected ? 'connected' : state.settings.enabled ? 'waiting' : 'disconnected'); }
function renderBusy() {
  $('connect').disabled = mutationCount > 0 || stopping;
  for (const id of ['shared-tabs', 'all-tabs', 'new-tabs', 'developer', 'quiet', 'focus-emulation']) $(id).disabled = mutationCount > 0 || stopping || !state;
  $('developer').disabled ||= !!state?.settings.quiet;
  $('focus-emulation').disabled ||= !state?.settings.quiet;
  for (const button of document.querySelectorAll('.tab button')) button.disabled = mutationCount > 0 || stopping;
  $('stop').textContent = t(stopping ? 'stopping' : 'stop');
  $('stop').disabled = stopping;
}
function renderState(nextState) {
  state = nextState;
  $('status').textContent = connectionText();
  $('dot').classList.toggle('online', state.connected);
  $('connect').hidden = state.connected;
  const allTabs = state.settings.allowAllTabs;
  // Keep the user's selected control value while its write is pending.
  // The next authoritative read confirms it or rolls it back after failure.
  if (!mutationCount) {
    $('all-tabs').checked = allTabs;
    $('shared-tabs').checked = !allTabs;
    $('new-tabs').checked = state.settings.allowNewTabs;
    $('developer').checked = state.settings.developer && !state.settings.quiet;
    $('quiet').checked = state.settings.quiet;
    $('focus-emulation').checked = state.settings.quiet && state.settings.focusEmulation;
  }
  $('developer-badge').hidden = !state.settings.developer || state.settings.quiet;
  $('emulation-badge').hidden = !state.settings.quiet || !state.settings.focusEmulation;
  $('quiet-hint').textContent = t(state.settings.quiet ? 'quietHint' : 'quietOffHint');
  $('developer-hint').textContent = t(state.settings.quiet ? 'developerQuiet' : 'developerHint');
  $('access-hint').textContent = t(allTabs ? 'allHint' : 'individualHint');
  const inUse = Object.values(state.leases).filter(lease => lease.session).length;
  $('session-summary').textContent = t(inUse ? 'summary' : 'summaryNone', { count: inUse });
  renderBusy();
  $('diagnostic-version').textContent = version;
  $('diagnostic-connection').textContent = connectionText();
  $('diagnostic-mode').textContent = t(allTabs ? 'all' : 'individual');
  $('diagnostic-error').textContent = state.lastError;
  $('diagnostic-error').hidden = !state.lastError;
  showError();
}
function tabState(tab) {
  const lease = state.leases[tab.id];
  const blocked = !!state.blockedTabs[tab.id];
  const accessible = state.settings.allowAllTabs ? !blocked : !!lease;
  return { lease, accessible, status: blocked ? 'blocked' : lease?.session ? 'in-use' : accessible ? 'available' : 'unshared' };
}
function badge(key, className = key) {
  const element = document.createElement('span');
  element.className = `badge ${className}`;
  element.textContent = t(key);
  return element;
}
function renderTabs() {
  const query = $('search').value.trim().toLocaleLowerCase();
  const filter = $('filter').value;
  const filtered = [...tabs].sort((a, b) => Number(!!b.current) - Number(!!a.current)).filter(tab => {
    const host = new URL(tab.url).host;
    return (!query || `${tab.title || ''} ${host}`.toLocaleLowerCase().includes(query)) && (filter === 'all' || tabState(tab).status === filter);
  });
  const focusedTab = document.activeElement?.closest('.tab')?.dataset.tabId;
  const fragment = document.createDocumentFragment();
  for (const tab of filtered) {
    const { lease, accessible, status } = tabState(tab);
    const row = document.createElement('div'); row.className = 'tab'; row.dataset.tabId = tab.id;
    const info = document.createElement('div'); info.className = 'tab-info';
    const titleLine = document.createElement('div'); titleLine.className = 'tab-title-line';
    const title = document.createElement('span'); title.className = 'tab-title'; title.textContent = tab.title || t('untitled'); title.title = title.textContent;
    titleLine.append(title);
    if (tab.current) titleLine.append(badge('current'));
    const detail = document.createElement('div'); detail.className = 'tab-detail';
    const origin = document.createElement('span'); origin.className = 'tab-origin'; origin.textContent = new URL(tab.url).host; origin.title = origin.textContent;
    const statusBadge = badge(status === 'in-use' ? 'inUse' : status, status);
    if (lease?.session) statusBadge.title = t('session', { session: lease.session });
    detail.append(origin, statusBadge);
    const label = t(state.settings.allowAllTabs ? accessible ? 'block' : 'allow' : lease ? 'revoke' : 'share');
    const button = document.createElement('button'); button.textContent = label; button.setAttribute('aria-label', `${label} ${tab.title || t('untitled')}`);
    button.disabled = mutationCount > 0 || stopping;
    button.onclick = () => action({ type: accessible ? 'ui.revoke' : 'ui.grant', tabId: tab.id });
    info.append(titleLine, detail); row.append(info, button); fragment.append(row);
  }
  $('tabs').replaceChildren(fragment);
  if (focusedTab) $('tabs').querySelector(`[data-tab-id="${focusedTab}"] button`)?.focus({ preventScroll: true });
  $('tab-count').textContent = t('count', { shown: filtered.length, total: tabs.length });
  $('empty').hidden = filtered.length > 0;
  $('empty-text').textContent = t(tabs.length ? 'noMatches' : 'noTabs');
  $('reset-filter').hidden = !query && filter === 'all';
}
async function refreshState() {
  const generation = ++stateGeneration;
  try {
    const result = await send({ type: 'ui.status' });
    if (generation === stateGeneration) { renderState(result); if (tabs) renderTabs(); }
  } catch (error) { if (generation === stateGeneration) { actionError = error; showError(); } }
}
async function render() {
  const generation = ++renderGeneration;
  refreshQueued = false;
  listLoading = true;
  $('tabs-loading').hidden = !!tabs;
  $('tabs').setAttribute('aria-busy', 'true');
  // Connection/settings must not wait for a potentially slow browser-wide scan.
  const stateRevision = ++stateGeneration;
  const stateRequest = send({ type: 'ui.status' }).then(nextState => {
    if (generation === renderGeneration && stateRevision === stateGeneration) { renderState(nextState); if (tabs) renderTabs(); }
    return nextState;
  });
  const tabsRequest = send({ type: 'ui.tabs' });
  try {
    const [, result] = await Promise.all([stateRequest, tabsRequest]);
    if (generation === renderGeneration && state) { tabs = result.tabs; renderTabs(); }
  } catch (error) {
    if (generation === renderGeneration) { actionError = error; showError(); }
  } finally {
    if (generation === renderGeneration) {
      listLoading = false;
      $('tabs-loading').hidden = true;
      $('tabs').setAttribute('aria-busy', 'false');
      if (refreshQueued) scheduleRefresh();
    }
  }
}
function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    if (listLoading) { refreshQueued = true; void refreshState(); }
    else void render();
  }, 100);
}
async function action(message) {
  if (stopping || (mutationCount && message.type !== 'ui.stop')) return;
  if (message.type === 'ui.stop') stopping = true;
  mutationCount++;
  actionError = null;
  renderBusy(); showError();
  try { await send(message); }
  catch (error) { actionError = error; }
  finally {
    mutationCount--;
    if (message.type === 'ui.stop') stopping = false;
    renderBusy();
    // Read authoritative state after success or failure; never replay a write.
    await render();
  }
}
function setDiagnostics(open) {
  $('diagnostics-panel').hidden = !open;
  $('diagnostics').setAttribute('aria-expanded', String(open));
  if (open) { $('copy-status').textContent = ''; $('close-diagnostics').focus(); }
  else $('diagnostics').focus();
}
$('version').textContent = version;
$('connect').onclick = () => action({ type: 'ui.connect' });
$('refresh').onclick = () => { actionError = null; void render(); };
$('stop').onclick = () => action({ type: 'ui.stop' });
for (const id of ['shared-tabs', 'all-tabs']) $(id).onchange = event => action({ type: 'ui.settings', allowAllTabs: event.target.value === 'all' });
$('new-tabs').onchange = () => action({ type: 'ui.settings', allowNewTabs: $('new-tabs').checked });
$('quiet').onchange = () => action({ type: 'ui.settings', quiet: $('quiet').checked });
$('focus-emulation').onchange = () => action({ type: 'ui.settings', focusEmulation: $('focus-emulation').checked });
$('developer').onchange = () => action({ type: 'ui.settings', developer: $('developer').checked });
$('language').onchange = () => {
  languageChanged = true; language = $('language').value; applyLanguage();
  chrome.storage.local.set({ uiLanguage: language }).catch(error => { actionError = error; showError(); });
};
function filterTabs() { if (state && tabs) renderTabs(); document.querySelector('.tab-list').scrollTop = 0; }
$('search').oninput = filterTabs;
$('filter').onchange = filterTabs;
$('reset-filter').onclick = () => { $('search').value = ''; $('filter').value = 'all'; filterTabs(); $('search').focus(); };
$('diagnostics').onclick = () => setDiagnostics($('diagnostics-panel').hidden);
$('close-diagnostics').onclick = () => setDiagnostics(false);
document.addEventListener('keydown', event => { if (event.key === 'Escape' && !$('diagnostics-panel').hidden) { event.preventDefault(); setDiagnostics(false); } });
$('copy-diagnostics').onclick = async () => {
  if (!state) return;
  // Counts and capability flags only: no page titles, URLs or session IDs.
  const diagnostics = { version, connected: state.connected, enabled: state.settings.enabled, allowAllTabs: state.settings.allowAllTabs, allowNewTabs: state.settings.allowNewTabs, developer: state.settings.developer && !state.settings.quiet, quiet: state.settings.quiet, focusEmulation: state.settings.quiet && state.settings.focusEmulation, webTabs: tabs?.length ?? null, inUse: Object.values(state.leases).filter(lease => lease.session).length };
  try { await navigator.clipboard.writeText(JSON.stringify(diagnostics, null, 2)); $('copy-status').textContent = t('copied'); }
  catch { $('copy-status').textContent = t('copyFailed'); }
};
chrome.runtime.onMessage.addListener(message => { if (message.type === 'ui.changed') scheduleRefresh(); });
applyLanguage();
chrome.storage.local.get('uiLanguage').then(({ uiLanguage }) => {
  if (!languageChanged && ['en', 'zh'].includes(uiLanguage)) { language = uiLanguage; applyLanguage(); }
}).catch(error => { actionError = error; showError(); });
void render();
