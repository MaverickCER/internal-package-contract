# Security policy

## Reporting a vulnerability

Report privately via a
[GitHub security advisory](https://github.com/MaverickCER/internal-package-contract/security/advisories/new).
If that form is unavailable, open a public issue that says only "requesting a private security
contact" with no details, and a maintainer will follow up. Please do not disclose the substance of
a suspected vulnerability in a public issue before it has been triaged.

## Distribution

This package is **never published to npm** (see the README) -- it is consumed directly from this
GitHub repository, as a git dependency. There is no npm registry attack surface (no npm publish
token, no OIDC trusted-publishing pipeline) to secure here the way a published package would need.
Consumers should pin to a tag (`#v1` or an exact `#vX.Y.Z`), not `#main`, once this repo has one.

## What this repo enforces on itself, and what it enforces on consumers

Self-hosted, via `npm run contract` (`scripts/run-contract.mjs` against this repo's own
`contract.ts`): dependency vulnerability scanning (`SecurityDeps`), secret scanning
(`SecuritySecrets`), supply-chain review (`SecuritySocket`), and branch protection on `main`
(deletion blocked, force-pushes blocked, merges require a PR).

The same three security checks, plus branch protection via `internal-package-contract init`, are
what every consumer of this package gets by adopting it -- see the README.

## Supported versions

Only the latest commit on the default branch is supported; there is no long-term-support branch.
