# Validation

Validated locally on 2026-10-09 using macOS (Apple Silicon), Node.js 25.8.1 and Chrome for Testing 152.0.7977.54. Chrome runs in a disposable profile with an isolated Native Messaging registration and a local HTTP fixture. No ordinary browser profile or signed-in website was used.

## Checks passed

- JavaScript syntax and extension resource checks.
- 5 unit/MCP compatibility tests: fragmented framing, malformed/truncated frames, request validation, independent lease/origin checks, and negotiation with the official MCP SDK.
- 15 real-browser checks within the E2E suite:
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
  15. Stop disconnects and revokes access.

## Scope of evidence

These are local functional tests, not a claim of feature parity or a long-term availability benchmark. Windows is unsupported. Linux registration/transport code and the Ubuntu CI template are present but have not yet been validated on a Linux host. Ordinary-profile installation still requires the user to load the unpacked extension and explicitly grant access.

GitHub Actions was not activated: the publishing OAuth credential does not include `workflow` scope. `ci.github-actions.yml` is the reviewed template for enabling automation with an authorized account.
