# Security policy

## Reporting a vulnerability

Report privately via a
[GitHub security advisory](https://github.com/MaverickCER/internal-package-contract/security/advisories/new).
If that form is unavailable, open a public issue that says only "requesting a private security
contact" with no details, and a maintainer will follow up. Please do not disclose the substance of
a suspected vulnerability in a public issue before it has been triaged.

## Distribution, and the threat model that follows from it

This package is **never published to npm** (see the README) -- it is consumed directly from this
GitHub repository, as a git dependency. But it is **the publishing pipeline of the whole ecosystem**:
`.github/workflows/release-npm-changesets.yml` is the reusable workflow every consumer calls, with
`id-token: write`, to publish to npm with provenance. Anyone who can change that workflow on the
commit a consumer pins can publish that consumer. So:

- **Consumers pin by commit.** A consumer's `uses:` of a workflow from this repository is pinned to a
  full commit SHA (never a branch or a floating tag), with the release tag in a trailing comment, and
  its `package.json` pins this package to a release tag (`#vX.Y.Z`), never `#main`.
  `dependency-pin-sync.yml` moves both together, in one pull request, when a new release is cut; a
  new pin is therefore always a reviewed change in the consumer, not something this repository can push.
- **The publishing job runs no repository code.** The release is three jobs: `version` (can write
  to the repository, holds no npm identity), `build` (read-only; installs with `--ignore-scripts`
  and runs the package's own `verify` gate), and `publish` (holds the npm identity but checks out and
  installs nothing: it publishes the exact tarball `build` produced, with a version-pinned npm).
- **Branch protection is part of the model.** `main` requires pull requests, the `self-check`
  status check (strict) and resolved review threads; the `BranchProtection` check verifies the same for
  every consumer.
- **Tags move only within a major.** The floating `v<major>` tag (`v0` while 0.x) is derived from the
  version just released; a 2.0.0 release creates `v2` and never moves `v1`.

## What this repo enforces on itself, and what it enforces on consumers

Self-hosted, via `npm run contract` (`scripts/run-contract.mjs` against `repo-contract.config.ts`,
this repository's own self-hosting contract): dependency vulnerability scanning (`SecurityDeps`), secret
scanning (`SecuritySecrets`), supply-chain review (`SecuritySocket`), code scanning (`CodeScanning`) and
branch protection on `main`. Every consumer gets the same checks through `contract.ts` by adopting it --
see the README.

### Known limits of those checks (intentional, documented)

- **`SecuritySocket` scores the version that is already published.** Socket scores a published
  package, so a dependency added in a release pull request is first scanned after it ships (and the
  release's own gate is the previous version's score). The pre-publish gates are `SecurityDeps`, `Licenses`
  and `DistNoUrls` on the exact tree being released; Socket is the post-publish backstop and the
  ecosystem's published packages have no runtime dependencies, which keeps the window small.
- **`SecurityDeps` audits production dependencies** (`npm audit --omit=dev`). The published packages
  have none, so for them it is vacuous by design; the exposure that matters is the development and CI
  tooling, which is covered by `SecurityDevDeps` (the same audit including development dependencies, a
  warning-grade finding unless it is a critical advisory) and Dependabot security updates.
- **`CodeRabbit` runs where its CLI is installed.** In CI the review is the GitHub App's; its
  findings gate a merge through required review-thread resolution on the branch ruleset, not through the
  CLI.

## Supported versions

Only the latest release is supported; there is no long-term-support branch.
