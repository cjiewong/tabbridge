# Security policy

TabBridge can access signed-in web pages and act through the user's browser. The [security model](docs/SECURITY.md) describes its grants, revocation, local trust boundary and data handling. A tab grant does not authorize payments, publication, deletion or credential changes.

## Supported versions

Security fixes target the latest release in the 0.2 series. Earlier releases are not maintained separately. This is an early project without a formal security audit, guaranteed response time or paid vulnerability bounty.

## Report a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/cjiewong/tabbridge/security/advisories/new). Reports should include:

- Affected release, OS, Node and Chrome versions.
- A minimal reproduction using a disposable profile and a local fixture.
- The expected boundary and observed impact, including which access mode was enabled.
- A suggested fix, if available.

Do not include real cookies, tokens, credentials, private page content or a browser profile. Keep proof-of-concept data synthetic. Do not open public issues containing exploit details before a fix is available.

If the private form is unavailable, open a public issue containing only a request for a confidential reporting channel; include no vulnerability details. Maintainers will arrange follow-up when available. An acknowledgement is not a promise of a release date.

## Disclosure

Maintainers reproduce reports against supported releases, evaluate their impact and coordinate fixes with the reporter. Publish a security advisory when a confirmed vulnerability is fixed, with the affected versions and upgrade instructions. Credit reporters who want attribution.
