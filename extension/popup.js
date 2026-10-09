const $ = id => document.getElementById(id);
async function send(message) { const r = await chrome.runtime.sendMessage(message); if (r?.error) throw new Error(r.error); return r; }
async function action(message) { try { await send(message); await render(); } catch (e) { $('error').textContent = e.message; } }
async function render() {
  try {
    const state = await send({ type: 'ui.status' });
    $('status').textContent = state.connected ? 'Connected to local host' : state.settings.enabled ? 'Waiting for local host' : 'Disconnected';
    $('dot').classList.toggle('online', state.connected);
    $('connect').disabled = state.connected; $('connect').textContent = state.connected ? 'Connected' : 'Connect';
    $('error').textContent = state.lastError;
    $('new-tabs').checked = state.settings.allowNewTabs; $('developer').checked = state.settings.developer;
    $('tabs').replaceChildren(); $('empty').hidden = state.tabs.length !== 0;
    for (const tab of state.tabs) {
      const lease = state.leases[tab.id]; const row = document.createElement('div'); row.className = `tab${lease ? ' shared' : ''}`;
      const info = document.createElement('div'); info.className = 'tab-info';
      const title = document.createElement('span'); title.className = 'tab-title'; title.textContent = tab.title || 'Untitled';
      const detail = document.createElement('span'); detail.className = 'tab-origin'; detail.textContent = lease?.session ? `Session: ${lease.session}` : new URL(tab.url).host;
      const button = document.createElement('button'); button.textContent = lease ? 'Revoke' : 'Share'; button.setAttribute('aria-label', `${lease ? 'Revoke' : 'Share'} ${tab.title || 'Untitled'}`);
      button.onclick = () => action({ type: lease ? 'ui.revoke' : 'ui.grant', tabId: tab.id });
      info.append(title, detail); row.append(info, button); $('tabs').append(row);
    }
  } catch (e) { $('error').textContent = e.message; }
}
$('connect').onclick = () => action({ type: 'ui.connect' });
$('refresh').onclick = render;
$('stop').onclick = () => action({ type: 'ui.stop' });
$('new-tabs').onchange = () => action({ type: 'ui.settings', allowNewTabs: $('new-tabs').checked });
$('developer').onchange = () => action({ type: 'ui.settings', developer: $('developer').checked });
render();
