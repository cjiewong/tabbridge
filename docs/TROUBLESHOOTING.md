# Troubleshooting

Start with `node bin/tabbridge.mjs doctor` from the checkout. A successful handshake confirms connectivity, not that a website interaction will succeed. `doctor` prints local paths and the extension ID; redact personal paths before posting it publicly.

| Symptom / code | What to check |
| --- | --- |
| `NOT_CONNECTED`, native host not found | Run `setup` again, load the correct `extension/` folder, open the popup and press Connect. Moving the checkout or replacing Node requires setup again. |
| `NOT_READY` | The host started but the extension has not completed its handshake. Inspect the popup connection status before retrying a read. |
| `PROFILE_IN_USE` | Another Chrome profile owns this bridge directory. Disconnect its TabBridge connection, or install a separate instance with a distinct `TABBRIDGE_HOME`. Do not delete a live socket. |
| `UNSAFE_HOME`, `UNSAFE_SOCKET` | Use a private directory owned by your OS user. Do not use a symlink, shared directory or forwarded socket. |
| `TAB_NOT_GRANTED` | In individual mode, Share the exact tab in the popup, then claim it. Alternatively enable All web tabs deliberately. A released agent-created tab no longer retains creation ownership. |
| `TAB_BLOCKED` | Select Allow beside that tab if you want it covered by All web tabs. The global option does not override Block. |
| `SESSION_CONFLICT` | The tab belongs to another session. Let that session release it or explicitly revoke its access in the popup. Do not impersonate its session label. |
| `ORIGIN_CHANGED` | An individually shared tab changed origin. Share it again. All web tabs allows cross-origin navigation only while enabled. |
| `USER_TAB` | Individual mode refuses to close user tabs. Keep/release the tab, close it manually, or explicitly enable All web tabs before a user-requested closure. |
| `NEW_TABS_DISABLED`, `DEVELOPER_DISABLED` | Enable the specific capability in the popup only when the task needs it. |
| `PAGE_LOADING` after opening a tab | The requested HTTP(S) URL has not committed within the read budget. Retry only the read when appropriate, or inspect/close the owned loading tab; do not reopen or replay a write. Arbitrary `about:blank` and protected pages stay unsupported. |
| `READINESS_TIMEOUT` | `DOMContentLoaded` did not finish within the shared navigation/DOM/text budget. Inspect loading/network state and retry only the observation if appropriate. |
| `FOREGROUND_REQUIRED` | Chrome reports the tab as discarded or frozen. If Do not disturb is on, report the blocker and let the user restore the tab manually. Otherwise explicitly activate the exact authorized tab if the task needs it, then wait for expected content. |
| `QUIET_MODE` | Do not disturb blocks activation, arbitrary evaluation, closing a selected tab, or creating a new Chrome window. Continue in the background or release the tab; only the user may change the popup preference. |
| `FOCUS_EMULATION_UNAVAILABLE` | Chrome rejected optional background focus emulation. No foreground fallback was attempted. Report the blocker; the user can turn emulation off to use ordinary background operations. |
| `STALE_REF` | Read a fresh snapshot and use its current element references. References expire after another snapshot or navigation. |
| `TIMEOUT`, `DISCONNECTED`, partial batch | Inspect the page and completed batch results before another action. A lost response is not proof that a write failed. Never replay the whole batch automatically. |
| Blank modal overlay or a control awaiting foreground focus | Check Do not disturb first: when enabled, wait or report the blocker, optionally letting the user enable background focus emulation. Only with quiet disabled, for the exact authorized tab, run `activate TAB --session NAME` or MCP `browser_activate`, optionally with `waitForText`/`timeoutMs`, then read a fresh snapshot. Inspect tab/window and document visibility/focus; wait for the actual dialog/table content. Do not repeat a click, reload the page or change disabled attributes to force progress. Activation is not a guarantee that every site bug will recover. |
| Popup settings appear before the tab list | The two load independently. Connection/capability controls become available when their authoritative state arrives; a slow tab scan keeps its own loading indicator. Use Refresh if the list fails. |
| Debugger attach fails | Close competing DevTools/debugger attachments to that tab if appropriate. Chrome internal pages and security dialogs remain unsupported. |

## Multiple installations

One `TABBRIDGE_HOME` can serve only one connected browser profile. A separate installation needs the same home in setup, the host wrapper and every CLI/MCP process:

```sh
TABBRIDGE_HOME="$PWD/.tabbridge-instance" node bin/tabbridge.mjs setup
TABBRIDGE_HOME="$PWD/.tabbridge-instance" node bin/tabbridge.mjs doctor
```

Keep the directory private and outside public commits. Add `TABBRIDGE_HOME` to the MCP process environment when using a custom instance. Select `--browser testing` for Chrome for Testing; Chrome 146+ has a separate native-host registration location from ordinary Chrome. Older Chrome for Testing versions are not the target of that registration option.

## Updating the extension and MCP tools

After updating the checkout, reload TabBridge in `chrome://extensions` and start a new MCP client session to refresh its tool list. A previously running client may keep the old tool schemas. The CLI can call `activate` with an optional `waitForText` JSON argument from the updated checkout once the extension has been reloaded. Reloading can affect grants and session state; inspect status and tab access before continuing an interrupted task.

## Tests

Install development dependencies with `npm ci` and the full Playwright browser with `npx playwright install chromium`. Chrome extension tests require Chromium's persistent context; the headless shell alone is insufficient. Linux runners also need browser system libraries (`npx playwright install --with-deps chromium`), `lsof`, `zip`, `unzip` and `tar`.

Use `TABBRIDGE_TEST_CHROME` only to choose a browser executable. The E2E suite always creates its own profile, native-host registration and local HTTP fixture. Do not point it at an ordinary browser profile. Set `TABBRIDGE_TEST_HEADED=1` to inspect its disposable window.

On Ubuntu 23.10+, a downloaded Chrome for Testing build may need its sandbox helper configured because AppArmor restricts unprivileged user namespaces. CI sets the matching downloaded `chrome_sandbox` helper to root ownership/mode 4755, selects it via the process-local `CHROME_DEVEL_SANDBOX` variable and enables Chromium's sandbox in the browser fixtures. This setup runs only on disposable CI runners. Follow [Chromium's sandbox guidance](https://chromium.googlesource.com/chromium/src/+/main/docs/security/apparmor-userns-restrictions.md) for your Linux host. Do not disable the sandbox or global AppArmor protections to make a test pass.

Report reproducible bugs using the issue template, including versions, access mode, sanitized error codes and a minimal public or local fixture. Report vulnerabilities through the [security policy](../SECURITY.md).
