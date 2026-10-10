# Architecture

## Process boundaries

`extension/background.js` is the authority for browser access. Only its own extension pages can grant tabs or change settings. It has no content-script messaging surface and no externally-connectable API. It uses Chrome's public `tabs`, `debugger`, `storage` and Native Messaging APIs.

Chrome launches `lib/native.mjs` through a generated shell wrapper. The host verifies the caller extension origin against the installed public extension ID. It accepts CLI requests over a private Unix domain socket, checks protocol inputs, assigns independent request IDs, and forwards messages to the extension. Chrome never receives credentials extracted from a browser profile; operations execute in the already-running browser.

CLI requests and native messages use 4-byte little-endian length-prefixed JSON. Client-to-host and host-to-extension messages are capped at 1 MiB; extension responses and socket output at 8 MiB. MCP uses standard newline-delimited JSON-RPC on stdin/stdout. Diagnostics go to stderr.

`lib/mcp.mjs` implements the small MCP surface needed here: initialize, ping, tools/list and tools/call. Compatibility is checked using the official TypeScript MCP SDK as a client. Browser screenshots return MCP image content.

Tool calls are checked against the JSON Schema subset declared in `lib/tools.mjs` before contacting Chrome: required/undeclared fields, primitive types, numeric bounds, array limits and batch step structure. Only own properties count as required or declared fields. The extension remains the authority for permissions and action-specific validation.

For file selection, the host validates up to 16 explicit absolute paths, resolves them to existing regular files and forwards paths rather than copying file bytes into protocol messages. If the client disconnects during this preparation, the host does not dispatch the action. Chrome selects the files through `DOM.setFileInputFiles` after the extension checks its tab lease and the referenced file input. Clearing uses the platform-supported empty input value; no form submission is added.

## Ownership

The extension stores tab leases in `chrome.storage.session`. A lease records tab ID, origin, session owner, whether the tab was created by an agent, and whether access came from the global option. User grants initially have no session; the first explicit claim sets ownership. With All web tabs enabled, discovery covers eligible HTTP(S) tabs and the first action auto-claims an unowned tab. The global option persists in local storage; per-tab exclusions live in session storage. Disabling it invalidates global leases while retaining valid individual grants. CLI session names are supplied by the caller. MCP defaults to a random process-specific session.

Concurrent operations on one tab are serialized. Different tabs can progress independently. Individual user tab access expires on cross-origin navigation unless global access is active. Tab leases and per-tab exclusions expire on browser restart, while the user-selected All web tabs setting persists. Revocation detaches the debugger and discards snapshots. Release keeps the browser tab open.

## Observation and actions

The browser module converts a full accessibility tree into compact text. Each snapshot creates a new reference generation backed by Chrome backend DOM node IDs. An action must use the current generation. Navigation, detach and revocation invalidate references. Password accessibility values are redacted.

Click uses content quads and Chrome input dispatch after checking that the element is visible and unobscured. Fill focuses/selects the field and sends browser text input. DOM JavaScript is used internally for bounded element inspection and native select changes. General expression evaluation is separately opt-in.

Activation uses Chrome's `tabs.update({ active: true })` and `windows.update({ focused: true })` APIs after checking the tab lease. A minimized target window is restored to normal state. It needs no debugger attachment and adds no manifest permission. Snapshots expose tab selection and window focus independently. A focus change can trigger normal page visibility/focus handlers; it does not grant web user activation, replay actions or dismiss browser security UI.

The popup loads its connection/settings state independently of the web-tab list. A slow `tabs.query` response does not block the status or capability controls. Each refresh has a generation token so older asynchronous responses cannot overwrite a newer render. Tab rows are built in a detached fragment and inserted together; no browser page data is cached persistently for popup performance.

Diff snapshots report changed text plus the current reference map, so omitted unchanged nodes never leave the agent with invalid stale IDs.

Hover and drag share click's visibility/hit-testing and fresh backend-node references. Drags use bounded mouse movement and Chrome's drag interception/events for native HTML5 payloads, falling back to the same pointer gesture when no HTML5 drag is produced. File drag payloads are refused. Mouse release/interception cleanup never starts another drag or reattaches a revoked debugger.

Plain text extraction returns a bounded rendered body/subtree without reading input values. Screenshots can capture the viewport, a full-page clip or an element box, with pixel/dimension and message-size limits. These operations do not enable general JavaScript evaluation.

Network capture is explicitly enabled per authorized tab and records at most 100 HTTP(S) request metadata entries in memory. It strips URL query/fragment/credential information and does not store request headers, cookies, post data or response bodies. Stop retains the bounded records for inspection; release/revocation/debugger detach clears them. There is no persistent cross-tab index.

## Recovery

- Native host startup rejects a live socket belonging to another Chrome profile. It only removes a same-user, stale Unix socket.
- The extension reconnects with bounded backoff when its native messaging port closes.
- Client writes are never replayed automatically. A lost response is explicitly reported as an unknown outcome.
- Requests expire before entering an execution queue, preventing delayed queued work from starting after the host's deadline.
- Disconnecting a CLI/MCP client cancels its queued commands and the remaining steps of its batch. Already-dispatched browser actions cannot be rolled back.
- Batches stop at the first failure and report how many steps completed. Expiration of an in-flight browser action cannot undo it.
- Revocation/debugger detach invalidates the active action scope. A late attachment is detached, and later commands in that action cannot reattach the debugger or resume after revocation.
- No website contents, form values or screenshots are persisted by the host. Explicit CLI screenshots are written only to the requested path.

## Source provenance

The implementation is original. The design was informed by public Chrome/MCP documentation and a review of generic architecture in the MIT-licensed `DeliciousBuding/codex-browser-bridge`. This repository contains no code from OpenAI's proprietary extension or bundled plugins. It does not imitate OpenAI process identities, talk to their protected pipe, disable their checks or provide ChatGPT side-chat integration.
