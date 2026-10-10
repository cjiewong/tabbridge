import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { readFile, writeFile, mkdir, lstat, unlink } from 'node:fs/promises';
import { HOST, VERSION, fault } from './protocol.mjs';
import { paths, secureHome, extensionId } from './paths.mjs';
import { request } from './client.mjs';

export const projectRoot = fileURLToPath(new URL('../', import.meta.url));
function quote(s) { return `'${s.replaceAll("'", "'\\''")}'`; }
export function manifestDirectory(browser = 'chrome', { platform = process.platform, userHome = os.homedir(), configHome = process.env.XDG_CONFIG_HOME } = {}) {
  if (platform === 'darwin') {
    const names = { chrome: 'Google/Chrome', chromium: 'Chromium', testing: 'Google/ChromeForTesting', edge: 'Microsoft Edge' };
    if (!names[browser]) throw fault('INVALID_BROWSER', 'Use chrome, chromium, testing, or edge');
    return path.join(userHome, 'Library/Application Support', names[browser], 'NativeMessagingHosts');
  }
  if (platform === 'linux') {
    const names = { chrome: 'google-chrome', chromium: 'chromium', testing: 'google-chrome-for-testing', edge: 'microsoft-edge' };
    if (!names[browser]) throw fault('INVALID_BROWSER', 'Unsupported browser');
    return path.join(configHome || path.join(userHome, '.config'), names[browser], 'NativeMessagingHosts');
  }
  throw fault('UNSUPPORTED_PLATFORM', 'Native host setup currently supports macOS and Linux');
}
export async function setup({ browser = 'chrome', manifestDir } = {}) {
  const p = paths(); await secureHome();
  if (Buffer.byteLength(p.socket) > 100) throw fault('PATH_TOO_LONG', 'Use a shorter TABBRIDGE_HOME for the Unix socket');
  const manifest = JSON.parse(await readFile(path.join(projectRoot, 'extension/manifest.json'), 'utf8'));
  const id = extensionId(manifest.key);
  const wrapper = path.join(p.home, 'native-host');
  const content = `#!/bin/sh\nexport TABBRIDGE_HOME=${quote(p.home)}\nexec ${quote(process.execPath)} ${quote(path.join(projectRoot, 'bin/tabbridge.mjs'))} native-host "$@"\n`;
  await writeFile(wrapper, content, { mode: 0o700 });
  const dir = manifestDir || manifestDirectory(browser); await mkdir(dir, { recursive: true });
  const manifestPath = path.join(dir, `${HOST}.json`);
  const native = { name: HOST, description: 'TabBridge local Chrome bridge', path: wrapper, type: 'stdio', allowed_origins: [`chrome-extension://${id}/`] };
  await writeFile(manifestPath, JSON.stringify(native, null, 2) + '\n', { mode: 0o600 });
  await writeFile(p.config, JSON.stringify({ version: VERSION, extensionId: id, manifestPath, projectRoot }, null, 2) + '\n', { mode: 0o600 });
  return { extensionId: id, extensionPath: path.join(projectRoot, 'extension'), manifestPath, next: 'Load the extension folder in chrome://extensions (Developer mode → Load unpacked). Open TabBridge and press Connect.', mcp: { command: process.execPath, args: [path.join(projectRoot, 'bin/tabbridge.mjs'), 'mcp'], env: { TABBRIDGE_HOME: p.home } } };
}
export async function doctor() {
  const p = paths(); const checks = { platform: process.platform, node: process.version, home: p.home, socket: p.socket };
  try { checks.config = JSON.parse(await readFile(p.config, 'utf8')); await lstat(checks.config.manifestPath); checks.nativeManifest = 'present'; } catch (e) { checks.setupError = e.message; }
  try { checks.browser = await request('status', {}, { timeout: 3000 }); checks.ok = true; } catch (e) { checks.ok = false; checks.connectionError = { code: e.code, message: e.message }; }
  return checks;
}
export async function uninstall() {
  const p = paths(); const c = JSON.parse(await readFile(p.config, 'utf8'));
  const manifest = JSON.parse(await readFile(c.manifestPath, 'utf8'));
  if (manifest.name !== HOST || manifest.path !== path.join(p.home, 'native-host')) throw fault('UNSAFE_MANIFEST', 'Manifest is not owned by this installation');
  for (const f of [c.manifestPath, path.join(p.home, 'native-host'), p.config]) await unlink(f);
  return { removed: true, next: 'Disconnect and remove the TabBridge extension from Chrome. Browser data is preserved.' };
}
