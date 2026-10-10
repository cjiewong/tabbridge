# Changelog

## Unreleased

- Add `browser_activate` / CLI `activate` to select authorized tabs, focus their Chrome windows and restore minimized windows, with tab/window focus state in snapshots and regressions for background dialogs, MCP/CLI calls and denied access.
- Load popup connection/settings independently of the tab list, batch DOM updates and discard obsolete refresh responses so slow tab scans do not block the primary controls.
- Isolate platform-path tests from a Linux runner's `XDG_CONFIG_HOME`, and keep revocation-test queues blocked until revocation completes rather than relying on UI timing.
- Enable Chromium's sandbox in E2E and use the Ubuntu runner's installed Chrome sandbox helper for downloaded testing builds.
- Add checked-in CI for Node.js 22/24 on macOS and Ubuntu, real-browser E2E jobs, distribution smoke checks and release artifacts, with pinned actions and read-only job permissions.
- Add security reporting, contribution/PR guidance, conduct rules, issue templates, dependency-update configuration, troubleshooting and a documented release procedure.
- Validate MCP argument types, numeric bounds and nested batch structures before forwarding a request to Chrome; reject undeclared prototype-named arguments.
- Correct the macOS Chrome for Testing Native Messaging registration location for Chrome 146+.
- Build extension archives from an explicit resource list, reject symlinked files, discard stale ZIP entries and generate SHA-256 checksums.
- Check version consistency, CLI/MCP method coverage, extension resources and local documentation links; smoke-test the extracted CLI/setup distribution without runtime dependencies.

## 0.2.1 — 2026-10-10

- Allow closing user-owned tabs controlled by the requesting session when All web tabs is enabled, including tabs whose creation ownership was lost after a reload.
- Preserve close refusal for individual-sharing mode, blocked tabs and other sessions' tabs.
- Clarify close access in the popup, MCP tools, agent instructions and English/Chinese documentation.

## 0.2.0 — 2026-10-10

- Add the opt-in **All web tabs** mode: CLI/MCP can discover and auto-claim current and future HTTP(S) tabs without individual Share or claim steps.
- Preserve session isolation while allowing cross-origin web navigation under the global grant.
- Add per-tab Block/Allow controls; disabling global access revokes its leases and restores individual sharing.
- Persist the global option across Chrome restarts and reset it on Stop & revoke all.
- Expand real-browser tests for global discovery, auto-claiming, blocking, revocation, session conflicts and full Chrome restart recovery.

## 0.1.0 — 2026-10-09

First independent release of TabBridge.

- Chrome MV3 extension with explicit tab sharing, new-tab and developer-mode controls, and stop/revoke.
- Dependency-free Node Native Messaging host and Unix socket transport.
- CLI and 22-tool MCP stdio server.
- Compact accessibility snapshots, fresh element references and diff output.
- Browser input, native select controls, navigation, viewport screenshots, text waits, dialogs and console logs.
- Session isolation, origin revocation, bounded messages, reconnect backoff and no automatic replay of uncertain writes.
- Tests with the official MCP SDK and real Chrome in disposable profiles.
- English/Chinese setup guides, architecture/security documentation and a ready-to-enable CI template.

This initial version has a deliberately explicit feature matrix. See README for current limitations.
