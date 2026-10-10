const $ = id => document.getElementById(id);
let renderGeneration = 0;
async function send(message) { const r = await chrome.runtime.sendMessage(message); if (r?.error) throw new Error(r.error); return r; }
async function action(message) { try { await send(message); await render(); } catch (e) { $('error').textContent = e.message; } }
function renderState(state) {
  $('status').textContent = state.connected ? 'Connected to local host' : state.settings.enabled ? 'Waiting for local host' : 'Disconnected';
  $('dot').classList.toggle('online', state.connected);
  $('connect').disabled = state.connected; $('connect').textContent = state.connected ? 'Connected' : 'Connect';
  $('error').textContent = state.lastError;
  const allTabs = state.settings.allowAllTabs;
  for (const id of ['all-tabs', 'new-tabs', 'developer']) $(id).disabled = false;
  $('all-tabs').checked = allTabs; $('new-tabs').checked = state.settings.allowNewTabs; $('developer').checked = state.settings.developer;
  $('tabs-heading').textContent = allTabs ? 'All web tabs' : 'Share a tab';
  $('access-hint').textContent = allTabs ? 'All web tabs are available, across navigation and Chrome restarts. Block individual tabs below. Each tab is still controlled by one agent session at a time.' : 'Shared tabs include their page content and frames. Access ends when you revoke it, the origin changes, or Chrome restarts.';
}
function renderTabs(state, tabs) {
  const allTabs = state.settings.allowAllTabs;
  const fragment = document.createDocumentFragment();
  $('empty').hidden = tabs.length !== 0;
  for (const tab of tabs) {
    const lease = state.leases[tab.id]; const accessible = allTabs ? !state.blockedTabs[tab.id] : !!lease;
    const row = document.createElement('div'); row.className = `tab${accessible ? ' shared' : ''}`;
    const info = document.createElement('div'); info.className = 'tab-info';
    const title = document.createElement('span'); title.className = 'tab-title'; title.textContent = tab.title || 'Untitled';
    const detail = document.createElement('span'); detail.className = 'tab-origin'; detail.textContent = lease?.session ? `Session: ${lease.session}` : new URL(tab.url).host;
    const label = allTabs ? accessible ? 'Block' : 'Allow' : lease ? 'Revoke' : 'Share';
    const button = document.createElement('button'); button.textContent = label; button.setAttribute('aria-label', `${label} ${tab.title || 'Untitled'}`);
    button.onclick = () => action({ type: accessible ? 'ui.revoke' : 'ui.grant', tabId: tab.id });
    info.append(title, detail); row.append(info, button); fragment.append(row);
  }
  $('tabs').replaceChildren(fragment);
}
async function render() {
  const generation = ++renderGeneration;
  $('tabs-loading').hidden = false;
  $('tabs').setAttribute('aria-busy', 'true');
  // Connection/settings must not wait for a potentially slow browser-wide scan.
  const stateRequest = send({ type: 'ui.status' }).then(state => {
    if (generation === renderGeneration) renderState(state);
    return state;
  });
  const tabsRequest = send({ type: 'ui.tabs' });
  try {
    const [state, result] = await Promise.all([stateRequest, tabsRequest]);
    if (generation === renderGeneration) renderTabs(state, result.tabs);
  } catch (e) {
    if (generation === renderGeneration) $('error').textContent = e.message;
  } finally {
    if (generation === renderGeneration) {
      $('tabs-loading').hidden = true;
      $('tabs').setAttribute('aria-busy', 'false');
    }
  }
}
$('connect').onclick = () => action({ type: 'ui.connect' });
$('refresh').onclick = render;
$('stop').onclick = () => action({ type: 'ui.stop' });
$('all-tabs').onchange = () => action({ type: 'ui.settings', allowAllTabs: $('all-tabs').checked });
$('new-tabs').onchange = () => action({ type: 'ui.settings', allowNewTabs: $('new-tabs').checked });
$('developer').onchange = () => action({ type: 'ui.settings', developer: $('developer').checked });
render();
