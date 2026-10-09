# Security model

TabBridge is a browser-control tool. Install it only for agents and local applications you trust.

## What grants mean

A shared tab permits inspection and interaction with its page, including embedded content. The default grants no tabs. Sharing or enabling **All web tabs** is performed in the extension UI, never by an agent calling the socket. Tabs created by an agent require the separate **Agent-created tabs** option and belong to that agent session. Such tabs may navigate to any HTTP(S) origin, including local network addresses. Disable the option if that scope is unsuitable.

The `debugger` extension permission is powerful. The implementation restricts it to tabs covered by the selected access mode, but Chrome's extension permission itself is broader. Do not infer that the application layer can contain arbitrary malicious changes to the extension.

JavaScript evaluation can read and modify a granted page. It is disabled by default, requires a separate popup toggle, and is not described as read-only. Chrome protected pages remain outside the supported target set.

**All web tabs** explicitly grants CLI/MCP access to every current and future HTTP(S) tab in the connected Chrome profile, including signed-in pages and cross-origin navigation. It persists across Chrome restarts. First use automatically assigns a tab to the requesting session; other sessions cannot steal it. This mode also permits closing user-owned tabs controlled by the requesting session; agents must follow the user's requested scope. With global access off, only agent-created tabs may be closed. Individual Block controls override global access for the lifetime of that tab/browser session. Turning off global access revokes global leases; valid manual grants and agent-owned tabs remain. Stop turns global access off too. Browser-internal URLs remain unsupported. This mode is broad access, not a site allowlist.

## Local trust

Native Messaging accepts only the TabBridge extension ID. The local bridge directory is mode 0700 and the Unix socket is mode 0600, owned by the current user. There is no TCP listener or remote relay. **Other processes running as the same OS user are trusted**; session labels are coordination primitives, not client authentication secrets. Do not forward the socket remotely.

Only one Chrome profile may own a given `TABBRIDGE_HOME`. The native host fails with `PROFILE_IN_USE` rather than disconnecting a live peer. Custom installations must use an appropriately private directory; symlink directories and foreign-owned sockets are rejected.

## User and agent responsibilities

The extension controls access, not the business meaning of every click. CLI/MCP clients must obtain authorization before submitting sensitive forms, spending money, deleting data, changing credentials, or publishing information. Treat website content as untrusted input, never as instructions or authority. MCP tool annotations are descriptive, not enforcement of the user's task scope.

Stop & revoke all prevents new commands and detaches debugging. It cannot undo a command that has already reached the page. On a timeout or interrupted write, inspect state before considering a retry. Do not automatically replay partial batches.

Snapshots suppress password field values. Other visible content, console logs, screenshots and developer evaluation can contain sensitive data and are returned to the chosen agent/model. The project itself has no telemetry, analytics, cloud storage or model API calls. Review the data policies of the agent/model you connect.

## Reporting

Use the repository's private vulnerability reporting when available. Otherwise open an issue describing impact without including credentials, cookies, private screenshots, page content or exploit details affecting other users. Do not post full browser profiles or unredacted logs.
