# Release procedure

Building a release is local and does not publish to npm, Chrome Web Store or GitHub Releases. The extension remains an unpacked, open-source installation.

## Prepare

1. Review the diff for local profiles, host registrations, personal paths, credentials, logs and private screenshots.
2. Update the version together in `package.json`, both root version fields in `package-lock.json`, `extension/manifest.json` and `lib/protocol.mjs`. `npm run check` rejects mismatches.
3. Move the relevant changelog entries from Unreleased into the dated version. Describe breaking changes and migration steps.
4. Keep English and Chinese setup instructions consistent. Update validation evidence only for environments actually tested.

## Validate and build

Use Node.js 22+ and `npm ci`. The build requires the `zip` command; package tests also use `unzip` and `tar`.

```sh
npm run check
npm test
npx playwright install chromium
npm run test:e2e
npm run test:package
npm run pack:release
```

The packed CLI smoke check extracts an actual npm tarball, executes the CLI without installing runtime dependencies, and tests setup/uninstall in private temporary directories. It does not connect to a user's browser.

`dist/` contains the extension ZIP, the CLI/source npm tarball and a SHA-256 file for each. The extension archive uses an explicit file list, rejects symlinked resources, replaces an existing archive and normalizes timestamps. Repeated extension builds with identical inputs and the same ZIP toolchain should match. This is not a promise of byte-identical archives across every ZIP implementation.

When adding an extension resource, update `scripts/release-files.mjs`; the project check rejects unreviewed files and missing resources. Inspect the npm file list using `npm pack --dry-run --json --ignore-scripts`. Never bundle a real host configuration or profile.

Verify a downloaded artifact on macOS or Linux:

```sh
# Run inside the directory containing the archive and its checksum file.
shasum -a 256 -c tabbridge-extension-VERSION.zip.sha256
```

On Linux, `sha256sum -c` is also available. A checksum detects corruption; it does not authenticate the publisher. Obtain artifacts from this repository's official release or Actions pages, not an untrusted mirror.

## Publish deliberately

After the checks pass and the release commit is reviewed, the maintainer may create a version tag and GitHub Release, attach the artifacts and record the tested platforms. Do not describe an unexecuted workflow as passing. Uploading a ZIP does not install or register the Native Messaging host; users still need the source/CLI installation instructions.

npm publication and Chrome Web Store publication are separate decisions and are not performed by the build or CI. Existing 0.2 users update their checkout, reload the extension and rerun setup if Node or the checkout location changed.
