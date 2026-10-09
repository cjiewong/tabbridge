# TabBridge

**Your Chrome, connected to your CLI.**

TabBridge is an independent, local browser automation toolkit for Codex CLI and other MCP clients. It connects to the Chrome profile you already use, with explicit tab grants, separate agent sessions, compact accessibility snapshots and real browser input.

[简体中文](README.zh-CN.md) · [Security model](docs/SECURITY.md) · [Architecture](docs/ARCHITECTURE.md) · [Agent guide](docs/AGENT_GUIDE.md)

> **Early release (0.1).** This is an independently implemented project, not an OpenAI plugin or an official compatibility layer. It does not connect to private ChatGPT pipes, copy official plugin code, or bypass their authorization checks.

<img src="docs/assets/popup.png" width="410" alt="TabBridge extension popup showing connection status and explicit tab sharing">

## What works

- Connect an existing Chrome profile through Chrome Native Messaging. No debug TCP port or cloud relay.
- Share individual user tabs. Claim a tab for one CLI/MCP session; other sessions cannot operate it.
- Optionally let agents create their own background tabs. User tabs are never automatically closed.
- Read compact accessibility snapshots, use element references, and request state differences.
- Click, fill, select, press keys, scroll, navigate, wait for text, and inspect JavaScript dialogs.
- Capture viewport PNGs and read bounded in-memory console messages.
- Batch predictable actions and return a fresh snapshot. Partial failures identify completed steps.
- Opt into arbitrary JavaScript evaluation for development, independently from ordinary browsing.
- Reconnect after the native host exits. Never automatically replay a write with an uncertain outcome.
- Use the same browser through a standalone CLI or an MCP stdio server.

## Requirements

- Node.js **22+**
- Chrome **118+** (current stable recommended)
- macOS or Linux; macOS is the first validated platform

Windows native transport is not implemented. Chrome's protected pages and browser security dialogs are not automation targets.

## Install from source

```sh
git clone https://github.com/cjiewong/tabbridge.git
cd tabbridge
node bin/tabbridge.mjs setup
```

The runtime has **zero npm dependencies**. `npm install` is only needed for development/tests. Keep this checkout in place: the native host wrapper references its absolute path and your current Node executable. Rerun `setup` after moving the checkout or replacing Node.

1. Open `chrome://extensions` and enable **Developer mode**.
2. Choose **Load unpacked**, selecting this repository's `extension/` directory.
3. Pin TabBridge, open its popup, and press **Connect**.
4. Press **Share** beside a tab you want an agent to use. The grant covers its page and frames.
5. Run `node bin/tabbridge.mjs doctor`.

Agent-created tabs and developer JavaScript are **off by default**. Enable them individually in the popup if needed. **Stop & revoke all** disconnects the bridge and disables both options.

Setup only registers `io.github.cjiewong.tabbridge` in your user-level Chrome Native Messaging directory. It does not alter other extensions or their native hosts. You can select `--browser chromium`, `--browser edge`, or `--browser testing`; these registration paths are provided but require testing on your platform.

## Codex CLI / MCP

Run `setup` to print the exact absolute paths for your machine, then add:

```toml
[mcp_servers.tabbridge]
command = "/absolute/path/to/node"
args = ["/absolute/path/to/tabbridge/bin/tabbridge.mjs", "mcp"]
```

Or use Codex's MCP registration command with the corresponding absolute paths:

```sh
codex mcp add tabbridge -- /absolute/path/to/node /absolute/path/to/tabbridge/bin/tabbridge.mjs mcp
```

Start a new CLI session after registration. Example instruction:

> Use TabBridge. List the tabs I shared, claim the relevant tab, inspect its snapshot, fill the form with the details I provided, then show me the result. Keep the tab open.

Each MCP process gets a distinct session by default. Use `mcp --session task-name` only when you intentionally want processes to share ownership. [Agent usage guide](docs/AGENT_GUIDE.md) explains references, batches and cleanup.

## CLI

Commands print JSON. Use an explicit session name for each independent task:

```sh
node bin/tabbridge.mjs tabs --session research
node bin/tabbridge.mjs claim 123 --session research
node bin/tabbridge.mjs snapshot 123 --session research
# Use the actual reference returned by that snapshot:
node bin/tabbridge.mjs click 123 s1:e7 --session research
node bin/tabbridge.mjs snapshot 123 --diff --session research
node bin/tabbridge.mjs screenshot 123 --out page.png --session research
node bin/tabbridge.mjs release 123 --session research
```

For agent-created tabs, enable the popup option first:

```sh
node bin/tabbridge.mjs open https://example.com --session demo
# Inspect and operate the returned tab ID, then close it if disposable.
node bin/tabbridge.mjs close 456 --session demo
```

Run `tabbridge help` (or `node bin/tabbridge.mjs help`) for command syntax, and `tools` for complete MCP tool schemas. `--json` accepts structured parameters for batches and advanced operations.

## Connection and permissions

```text
CLI / MCP process
    │ per-user Unix socket (0600, parent directory 0700)
    ▼
Native host (started by Chrome)
    │ Chrome Native Messaging
    ▼
TabBridge extension
    │ explicit tab grant / agent-created tab ownership
    ▼
Chrome tabs + debugger APIs
```

User-tab grants are scoped to the current top-level origin. Cross-origin navigation revokes the grant. They survive a native-host reconnect, but expire when Chrome restarts. A user-shared tab requires `claim` before use. Other sessions do not see claimed tabs.

The local socket is trusted at the **OS-user boundary**: another process running as you can act as a client. Session names prevent accidental collisions, not hostile same-user impersonation. Never expose this socket over a network. See [Security](docs/SECURITY.md).

## Development

```sh
npm ci
npm run check
npm test
npx playwright install chromium
npm run test:e2e
npm run pack:extension
```

E2E tests use a disposable Chrome profile, a local fixture website and a profile-specific Native Messaging manifest. They do not read your ordinary browser profile. Set `TABBRIDGE_TEST_CHROME` to an existing Chrome for Testing executable to reuse it. Set `TABBRIDGE_TEST_HEADED=1` to watch the tests.

## CI template

`docs/ci.github-actions.yml` contains the GitHub Actions pipeline. Repository automation is not enabled in this initial publication because the publishing credential lacks the GitHub `workflow` scope. To enable it with an appropriately authorized account, place that file at `.github/workflows/ci.yml`. Local test results are recorded in `docs/VALIDATION.md`.

## Known limits

- This release is not feature parity with ChatGPT's browser integration. Side chat, official tab mentions and ChatGPT history synchronization are outside scope.
- Out-of-process/cross-origin iframe element targeting, file uploads/download management, drag-and-drop, mobile emulation and persistent DOM references across navigation are not yet supported as dedicated tools.
- Snapshot refs expire on the next snapshot or navigation. Diff output includes a fresh reference map.
- Screenshots currently capture the viewport. Chrome debug-attachment conflicts and protected targets produce explicit errors.
- A timeout does not prove a write failed. Inspect the page before retrying; batch errors can mean partial completion.
- Agents remain responsible for obtaining user authorization for consequential actions. A tab grant is permission to access the page, not permission to purchase, publish, delete data or change credentials.

## Uninstall

Disconnect in the popup, run `node bin/tabbridge.mjs uninstall`, then remove TabBridge from `chrome://extensions`. Website data, cookies and browsing history are not deleted.

## License and provenance

MIT. Independently implemented using public Chrome extension and CDP APIs and the MCP specification. Architectural inspiration includes [codex-browser-bridge](https://github.com/DeliciousBuding/codex-browser-bridge). No OpenAI extension, runtime or proprietary source is included. TabBridge is not affiliated with OpenAI or Google.
