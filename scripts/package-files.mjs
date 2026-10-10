import assert from 'node:assert/strict';
import { extensionFiles } from './release-files.mjs';

export function assertPackageFiles(packed) {
  const allowed = /^(?:bin\/tabbridge\.mjs$|lib\/[^/]+\.mjs$|extension\/|docs\/[^/]+\.md$|docs\/assets\/popup\.png$|package\.json$|README(?:\.zh-CN)?\.md$|LICENSE$|(?:SECURITY|CHANGELOG|CONTRIBUTING|CODE_OF_CONDUCT)\.md$)/;
  for (const { path: name } of packed.files) {
    assert.match(name, allowed, `Unexpected package resource: ${name}`);
    assert.ok(!/(?:^|\/)(?:\.[^/]+|node_modules|artifacts|profile)(?:\/|$)|\.(?:log|pem|sock)$/.test(name), `Local data in package: ${name}`);
    if (name.startsWith('extension/')) assert.ok(extensionFiles.includes(name.slice(10)), `Unexpected extension resource: ${name}`);
  }
}
