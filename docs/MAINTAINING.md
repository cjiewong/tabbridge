# Maintaining TabBridge

The repository owner, [@cjiewong](https://github.com/cjiewong), currently maintains releases and makes final scope decisions. Contributions are welcome; there is no guaranteed support response time. The [MIT license](../LICENSE) applies to code contributions unless a file explicitly states otherwise.

## Scope

TabBridge connects a local CLI/MCP client to Chrome through public extension APIs and Native Messaging. Prioritize reliable installation, understandable permissions, predictable browser actions and useful failure reports. Keep runtime dependencies at zero unless a dependency materially improves correctness.

Cloud relays, payment systems, storefront distribution and imitation of proprietary browser integrations are outside the current scope. New features must preserve the user's selected access mode, per-session ownership, revocation and no replay of uncertain writes.

## Review expectations

- Read architecture and security documentation before changing access, transport or sessions.
- Reproduce fixes and include regression coverage for meaningful failure modes.
- Run syntax/resource checks and unit tests; run E2E for host/browser/MCP changes.
- Verify installation and distribution changes using the packed CLI, not only a source checkout.
- Keep setup and permission changes aligned in both READMEs.
- Record limitations and separate local evidence from unexecuted CI/platform expectations.

## Repository settings

The workflow files configure read-only CI and pinned actions. Repository administrators should keep private vulnerability reporting enabled and configure branch protection/rulesets to require the CI checks before merging. Disable bypasses where practical; the repository owner remains responsible for emergency fixes. These files do not themselves enable branch protection or demonstrate that a hosted run passed.

Do not use privileged pull-request workflows to execute contributor code. CI uses disposable profiles and synthetic pages, without production credentials. Review dependency updates before merging; Dependabot never merges them automatically.

## Compatibility and releases

Only the latest 0.2 release receives fixes. During 0.x development, record breaking CLI/MCP or setup changes prominently in the changelog and include migration instructions. Browser/native protocol changes must reject incompatible peers explicitly. Aim to preserve the public interface within a patch release.

Follow the [release procedure](RELEASING.md). Build artifacts locally or in CI; publication, npm uploads and tag creation remain deliberate maintainer actions.
