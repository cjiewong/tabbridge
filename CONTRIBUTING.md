# Contributing

Thanks for helping improve TabBridge. Start with a reproducible problem or a concrete browser workflow. Use issues for ordinary bugs and feature requests; use the [security policy](SECURITY.md) for vulnerabilities. Please follow the [code of conduct](CODE_OF_CONDUCT.md).

## Development setup

Use Node.js 22 or newer on macOS or Linux. Clone the repository and run:

```sh
npm ci
npm run check
npm test
npx playwright install chromium
npm run test:e2e
npm run test:package
```

Runtime use needs no npm install. Development uses the locked Playwright and MCP SDK dependencies. Package tests need `zip`, `unzip` and `tar`; the host restart E2E check also uses `lsof`. On Linux, install browser libraries with `npx playwright install --with-deps chromium`. Reuse a compatible Chrome for Testing executable by setting `TABBRIDGE_TEST_CHROME`; do not reuse a live browser profile.

## Changes and review

Read [architecture](docs/ARCHITECTURE.md) and the [security model](docs/SECURITY.md) before changing access, transport or sessions. Preserve the selected access mode, per-session ownership, origin checks, revocation, message limits and no automatic replay of uncertain writes. Keep runtime dependencies at zero unless a dependency materially improves correctness.

Add meaningful regression tests for authorization, transport, action lifecycle and distribution changes. All browser tests must use disposable profiles and local fixtures. Documentation-only changes do not need unrelated browser tests; validate links with `npm run check`. Explain any applicable check you could not run.

Do not commit browser profiles, native-host installations, local absolute paths, authentication tokens, cookies, logs or screenshots of private pages. Use only original or license-compatible code with attribution. Do not copy proprietary browser plugin code.

Describe what changed, why, and how it was verified. Feature claims should distinguish tested behavior from platform assumptions. Keep English and Chinese setup instructions aligned, and add user-visible changes under Unreleased in the changelog. Do not bump versions or publish a release as part of an ordinary pull request.

When adding an extension resource, update `scripts/release-files.mjs`. Run `npm run test:package` for installation or packaging changes; it verifies the extracted distribution rather than relying on a source checkout.

## Finding work

Installation reliability, actionable errors, documented limitations and reproducible browser tests are useful contributions. For larger API or platform changes, describe the proposed behavior in an issue before implementing it so maintainers can assess compatibility and scope. See [maintainer guidance](docs/MAINTAINING.md) and [troubleshooting](docs/TROUBLESHOOTING.md).
