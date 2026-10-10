# Validation

Latest local validation on 2026-10-10 used macOS (Apple Silicon), Node.js 25.8.1 and Chrome for Testing 156.0.8078.4 from the installed Playwright dependency. The preceding maintenance/distribution changes also passed on Node.js 22.23.3. Chrome runs in disposable profiles with isolated Native Messaging registration and local HTTP fixtures. No ordinary browser profile or signed-in website was used.

## Checks passed

- JavaScript syntax, version/lockfile consistency, CLI/MCP method agreement, extension resource allowlisting and local documentation links.
- 14 unit/MCP/distribution tests: fragmented framing, malformed/truncated frames, request validation, independent lease/origin checks, official MCP SDK negotiation, malformed tool arguments (including types, numeric bounds, prototype-named fields and nested batches), MCP lifecycle/input limits, platform registration paths, isolated setup/uninstall, repeatable archives, stale ZIP entry removal and rejection of symlinked files/directories.
- Actual npm tarball extraction and CLI/setup/uninstall smoke check without runtime dependencies or a browser connection.
- GitHub Actions workflow checked with actionlint 1.7.12; issue forms and Dependabot YAML parsed locally.
- 35 real-browser checks within the E2E suite (37 Node test results including the two parent suites):
  1. Chrome extension → Native Messaging host handshake.
  2. Unshared tabs remain absent from agent discovery; new tabs disabled by default.
  3. Explicit claim, session isolation, user-tab close refusal and origin scope.
  4. Readable snapshots with password values suppressed.
  5. Batched fill/select/click/wait, readback and stale-reference refusal.
  6. Developer evaluation opt-in and disablement.
  7. Valid PNG screenshot.
  8. Live page text and image returned through an actual MCP SDK client.
  9. Partial batch stops after the first error without duplicating completed clicks.
  10. Separate CLI process reads the same authorized session.
  11. Disconnected clients' queued clicks do not execute later.
  12. Cross-origin navigation revokes a shared tab grant.
  13. Agent-created tabs are session-isolated and closable.
  14. Native-host restart reconnects without restarting Chrome.
  15. Stop disconnects, revokes access and disables the global option.
  16. Global discovery exposes unshared web tabs; first use auto-claims without Share.
  17. Global access covers future tabs and cross-origin web navigation.
  18. Per-tab Block overrides global access until Allow is selected.
  19. Disabling global access revokes global leases and restores manual sharing.
  20. Valid individual grants survive toggling the global option.
  21. Revoking global access prevents queued actions from executing.
  22. Global opt-in survives a full Chrome restart and authorizes fresh tabs.
  23. Global mode closes an existing user tab without Share/claim; blocked, foreign-session and individual-mode close requests remain rejected.
  24. Authorized activation reveals a dialog which is blank while its real page is hidden/unfocused; the fixture is tested without Playwright focus emulation.
  25. MCP activation selects the target in another window, restores a minimized window and focuses it; CLI activation and ungranted/blocked/foreign-session/protected-tab refusal are also checked.
  26. Popup status/settings remain available while the web-tab list reply is deliberately held.
  27. A delayed obsolete popup reply cannot replace a newer tab list.
  28. Rendered text is bounded and excludes hidden content and input/password values; foreign sessions are rejected.
  29. Hover reveals a real menu, batched hover produces fresh refs and stale refs are refused.
  30. Modifier select-all/Backspace and Shift input change a real field; malformed combinations cannot modify it.
  31. HTML5 and pointer gestures produce exactly one drop with real browser input.
  32. File selection delivers the expected local file bytes once, rejects missing/directory/relative paths and clears the input.
  33. Full-page and element images have their expected PNG dimensions; conflicting capture options are rejected.
  34. Explicit network capture records success, HTTP failure and transport failure; strips synthetic secrets, bounds the buffer to 100 requests and clears it on release.
  35. MCP SDK receives the new rendered-text and full-page screenshot results using the published tool schemas.

The foreground fixture launches its own disposable Chrome process and attaches the test driver to an ephemeral loopback debugging endpoint with `noDefaults: true`. This avoids synthetic focus/visibility overrides and does not disable Chrome's sandbox. Production TabBridge transport remains Native Messaging and a private Unix socket; it does not expose a debugging port.

The E2E browser fixtures enable Chrome's sandbox. Ubuntu CI configures the matching downloaded Chrome for Testing sandbox helper with root ownership/mode 4755 and a process-local `CHROME_DEVEL_SANDBOX` setting; it does not disable AppArmor or the browser sandbox.

## Scope of evidence

These are local functional tests, not a claim of feature parity, a formal security audit or a long-term availability benchmark. Windows is unsupported. Linux path selection is unit-tested, but Linux browser/host behavior has not yet been validated on a Linux host. Ordinary-profile installation still requires the user to load the unpacked extension and explicitly select its access mode.

The checked-in GitHub Actions workflow defines Node.js 22/24 checks on macOS/Ubuntu, E2E jobs and release artifacts. It has been linted locally; a completed hosted run is still needed to establish Ubuntu and Node.js 24 CI evidence. Branch protection is a separate repository setting. Private vulnerability reporting was enabled and verified through the GitHub API.
