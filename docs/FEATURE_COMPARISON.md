# Browser MCP feature comparison

Reviewed on 2026-10-10 against the public [Chrome MCP tool reference](https://github.com/hangwin/mcp-chrome/blob/master/docs/TOOLS.md) and [Chrome DevTools MCP tool reference](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/tool-reference.md). These are different projects: the first centers on a Chrome extension and native bridge, the second on developer diagnostics. This is a capability comparison, not a claim of equivalent implementations, reliability or permissions.

TabBridge's additions are original implementations using public Chrome APIs. No upstream runtime, proprietary plugin code or semantic-search dependency was imported.

| Capability | Chrome MCP / DevTools MCP reference | TabBridge |
| --- | --- | --- |
| Existing browser tabs and navigation | Both | Supported, with explicit grants/session ownership |
| Foreground tab selection | Both | `activate`, including minimized-window restoration |
| Accessibility references and form actions | Both | `snapshot`, `click`, `fill`, `select`, `batch` |
| Hover menus/tooltips | Both | `hover`; fresh refs after a resulting snapshot |
| Drag and drop | Both | `drag` for HTML5 and pointer drags within one viewport |
| Modifier key combinations | Both | `press`, including Control/Meta/Alt/Shift and select-all |
| Local file selection | Upload implementation / upload tool | `upload`, up to 16 explicit local files or clearing an input |
| Plain page text | Content/read tools / snapshots | `read`, bounded rendered text, optionally from a current ref |
| Viewport, full-page and element screenshots | Both | `screenshot`, with bounded full-page/ref options |
| Network diagnostics | Both | Explicit `network` start/read/stop; 100 recent request metadata records |
| Console and JavaScript dialogs | Both | Bounded `logs`, inspect/handle `dialog` |
| Arbitrary page JavaScript | Both | Separately opted-in `evaluate` |
| Cross-origin/out-of-process frame targeting | Frame-aware helpers exist; not tested in this review | Dedicated frame targeting remains unsupported |
| Response bodies and custom authenticated HTTP | Chrome MCP network tools / DevTools request details | Metadata only; no request/response-body tool |
| Browser history and bookmarks | Chrome MCP | Outside current tab-scoped functionality; would need new browser permissions |
| Semantic cross-tab indexing | Chrome MCP | No persistent index or embedded model; ordinary granted-tab discovery remains available |
| Device emulation, tracing, memory analysis | Primarily DevTools MCP | Future developer diagnostics; no claimed parity |
| Recording, video and workflow playback | Upstream capabilities vary | No recording/replay subsystem; uncertain writes are never replayed automatically |

## Chosen boundaries

The first expansion targets ordinary signed-in web workflows: menus, drag controls, document selection, reading, screenshots and actionable request status. It retains zero runtime dependencies, existing tab access modes and per-session ownership. It does not add browser history/bookmark permissions, content-script entry points, a TCP listener or a remote relay.

Uploads use current refs to enabled file inputs; hidden file choosers, remote URL downloads and file dragging are not implemented. A website may upload as soon as files are selected, so the agent must have permission for both the files and destination. Selection is not evidence that a server accepted an upload.

Network diagnostics record metadata only after an explicit start, omit headers/bodies and remove URL queries, fragments and credentials. Paths can still contain sensitive information. Records stay in memory and are cleared when debugging ends or access is released/revoked. This is intentionally smaller than a full DevTools network inspector.

All feature claims are verified against local fixtures in disposable profiles. An upstream feature list is not test evidence for TabBridge. See [validation](VALIDATION.md), [architecture](ARCHITECTURE.md) and [security](SECURITY.md).
