# Contributing

Use Node.js 22 or newer. Run `npm ci`, `npm run check`, `npm test` and `npm run test:e2e` before proposing a change. Install Playwright Chromium for E2E, or point `TABBRIDGE_TEST_CHROME` at a compatible Chrome for Testing executable.

Keep runtime dependencies minimal. Preserve explicit grants, origin checks, user-tab ownership, message limits and no automatic replay of uncertain writes. Add meaningful regression tests for authorization, transport and action lifecycle changes. All browser tests must use disposable profiles and local fixtures.

Do not commit browser profiles, native-host installations, local absolute paths, authentication tokens, cookies, logs or screenshots of private pages. Use only original or license-compatible code with attribution. Do not copy proprietary browser plugin code.

Describe what changed, why, and how it was verified. Feature claims should distinguish tested behavior from platform assumptions.
