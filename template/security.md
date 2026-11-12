# Security policy

## Reporting a vulnerability

Report privately through this repository's **Security** tab with **Report a vulnerability**
([how private reporting works](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)).
If that form is unavailable, open a public issue that says only "requesting a private security contact" with no
details, and a maintainer will follow up. Please do not disclose the substance of a suspected
vulnerability in a public issue before it has been triaged.

## What this repo's contract already enforces

`npm run contract` runs these on every pull request, and the repository's ruleset requires that job
before a merge:

- Dependency vulnerability scanning (`SecurityDeps` -- `npm audit` against a reviewed exception
  list at `.repo-contract/exceptions/security-deps.json`, not silently ignored findings).
- Secret scanning (`SecuritySecrets`, via secretlint).
- Supply-chain review (`SecuritySocket`, via Socket.dev) of the version already published, and the open
  code-scanning alerts of the ref being built (`CodeScanning`).
- A check that the default branch's ruleset blocks deletion and force-pushes, requires a pull request
  with the `contract` status check and resolved review threads (`BranchProtection`). The contract verifies
  the ruleset; `internal-package-contract init --github` applied it once.
- A published tarball containing only the files `package.json`'s `files` allowlist names (`GitHygiene`
  requires the field; `PackedConsumer` installs the packed tarball and imports every entry point).

## Supported versions

Only the latest published version receives security fixes. There is no long-term-support branch. This is
policy, not a mechanism.
