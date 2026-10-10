# Security policy

## Reporting a vulnerability

Report privately through this repository's **Security** tab with **Report a vulnerability**
([how private reporting works](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)).
If that form is unavailable, open a public issue that says only "requesting a private security contact" with no
details, and a maintainer will follow up. Please do not disclose the substance of a suspected
vulnerability in a public issue before it has been triaged.

## What this repo's contract already enforces

Adopting `internal-package-contract` gives this repository, mechanically, on every
`npm run contract`:

- Dependency vulnerability scanning (`SecurityDeps` -- `npm audit` against a reviewed exception
  list at `.repo-contract/exceptions/security-deps.json`, not silently ignored findings).
- Secret scanning (`SecuritySecrets`, via secretlint).
- Supply-chain review (`SecuritySocket`, via Socket.dev).
- Branch protection on the default branch (deletion blocked, force-pushes blocked, merges require
  a pull request -- see `internal-package-contract init`).
- A published tarball containing only the files `package.json`'s `files` allowlist names -- no dev
  tooling, no `.env`, no local paths.

## Supported versions

Only the latest published version receives security fixes. There is no long-term-support branch.
