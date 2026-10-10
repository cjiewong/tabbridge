import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { setup, uninstall, manifestDirectory } from '../lib/setup.mjs';
import { extensionId } from '../lib/paths.mjs';

test('native manifests use current browser registration paths on macOS and Linux', () => {
  // Explicitly suppress the runner's XDG_CONFIG_HOME when testing fallback paths.
  const options = { platform: 'darwin', userHome: '/test-user', configHome: null };
  assert.equal(manifestDirectory('chrome', options), '/test-user/Library/Application Support/Google/Chrome/NativeMessagingHosts');
  assert.equal(manifestDirectory('testing', options), '/test-user/Library/Application Support/Google/ChromeForTesting/NativeMessagingHosts');
  assert.equal(manifestDirectory('chromium', options), '/test-user/Library/Application Support/Chromium/NativeMessagingHosts');
  assert.equal(manifestDirectory('edge', options), '/test-user/Library/Application Support/Microsoft Edge/NativeMessagingHosts');
  assert.equal(manifestDirectory('testing', { ...options, platform: 'linux' }), '/test-user/.config/google-chrome-for-testing/NativeMessagingHosts');
  assert.equal(manifestDirectory('chrome', { ...options, platform: 'linux', configHome: '/custom-config' }), '/custom-config/google-chrome/NativeMessagingHosts');
  assert.throws(() => manifestDirectory('invalid', options), { code: 'INVALID_BROWSER' });
  assert.throws(() => manifestDirectory('chrome', { ...options, platform: 'win32' }), { code: 'UNSUPPORTED_PLATFORM' });
});

test('setup and uninstall operate only on an isolated host registration', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'tb-setup-'));
  const previousHome = process.env.TABBRIDGE_HOME;
  process.env.TABBRIDGE_HOME = path.join(temporary, 'bridge');
  try {
    const manifestDir = path.join(temporary, 'native-manifests');
    await mkdir(manifestDir);
    const installed = await setup({ manifestDir });
    const native = JSON.parse(await readFile(installed.manifestPath, 'utf8'));
    const extension = JSON.parse(await readFile('extension/manifest.json', 'utf8'));
    assert.equal(installed.extensionId, extensionId(extension.key));
    assert.deepEqual(native.allowed_origins, [`chrome-extension://${installed.extensionId}/`]);
    assert.equal(native.path, path.join(process.env.TABBRIDGE_HOME, 'native-host'));
    assert.match(await readFile(native.path, 'utf8'), /exec /);
    await uninstall();
    await assert.rejects(readFile(installed.manifestPath), { code: 'ENOENT' });
  } finally {
    if (previousHome === undefined) delete process.env.TABBRIDGE_HOME; else process.env.TABBRIDGE_HOME = previousHome;
    await rm(temporary, { recursive: true, force: true });
  }
});
