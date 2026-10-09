# Changelog

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
