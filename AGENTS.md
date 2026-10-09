# Project instructions

TabBridge is an independent Chrome extension, local Native Messaging host, CLI and MCP server. Keep runtime dependencies at zero unless a dependency materially improves correctness.

Read docs/ARCHITECTURE.md and docs/SECURITY.md before changes to access, transport or sessions. Preserve explicit tab grants, per-session ownership, origin revocation and no replay of uncertain writes. Do not weaken browser or application security controls to make a test pass.

Run `npm run check` and `npm test` for code changes. Run `npm run test:e2e` for browser, host or MCP behavior changes. Use a disposable browser profile and a local fixture. Never touch a user's live Chrome profile for automated tests.

Public commits must not contain local profile data, credentials, private screenshots, logs, personal host paths or proprietary plugin code. Keep English and Chinese setup instructions aligned. Document limitations honestly; a simulation or successful handshake is not evidence that page interactions work.
