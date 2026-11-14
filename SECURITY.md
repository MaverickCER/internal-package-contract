# Security policy

## Reporting a vulnerability

Report privately via a
[GitHub security advisory](https://github.com/MaverickCER/internal-package-contract/security/advisories/new).
If that form is unavailable, open a public issue that says only "requesting a private security contact", with no
details. A maintainer will follow up. Do not disclose the substance of a suspected vulnerability in a public
issue before it has been triaged.

## Disclosure

This section is maintainer policy; no mechanism enforces it. Reports are handled in private until they can be
disclosed without helping an attacker. A report is acknowledged, assessed and prioritised by severity,
exploitability and impact. Acknowledgement does not mean it is accepted as a vulnerability or that a fix can be
provided.

When a fix is available, a security advisory is published on this repository. It names:

- the affected versions;
- the patched version;
- the severity;
- what a user can do if they cannot upgrade at once;
- whether exploitation is known.

The advisory does not publish a working exploit before other systems' owners have had time to update. If a
vulnerability is being exploited, or a fix cannot be released promptly, users are warned and given mitigations
first. Resolved advisories stay public.

## Distribution, and the threat model that follows from it

This package is never published to npm (`"private": true`; `test/release-versions-private-package.test.ts`). It
is consumed from this repository as a git dependency. It is also the publishing pipeline of the whole fleet.
Every consumer calls the reusable workflow `.github/workflows/release-npm-changesets.yml`, with
`id-token: write`, to publish to npm with provenance. Anyone who can change that workflow on the commit a
consumer pins can publish that consumer. So:

- **Consumers pin by commit**. A consumer's `uses:` of a workflow here is pinned to a full commit SHA. The
  release tag goes in a trailing comment. The consumer's `package.json` pins this package to a release tag
  (`#vX.Y.Z`), never `#main`. `PinConsistency` fails the consumer's `contract` job when the three disagree or a pin is not a
  full SHA (`test/pin-consistency.test.ts`). It does not check that the SHA is on this repository's default
  branch. `dependency-pin-sync.yml` moves both pins in one pull request in the consumer. A new pin is therefore
  always a reviewed change there, not something this repository can push.
- **The job that holds the npm identity runs no repository code**. The release is three jobs
  (`test/release-workflow.test.ts`). `version` can write to the repository and holds no npm identity. `build`
  is read-only, installs with `--ignore-scripts` and does run repository code, the package's own `verify`
  script, without credentials. `publish` holds the npm identity but checks out and installs nothing. It
  publishes the exact tarball `build` produced with a version-pinned npm.
- **A tree that never passed its contract is not published**. The `build` job requires that a workflow run on
  a commit with exactly this tree finished a job named `contract` with success, and `required` where the run
  has it. A commit that bypassed the ruleset is therefore published only after a run on its tree passes.
- **Branch protection is part of the model**. The `main` ruleset of this repository requires pull requests,
  resolved review threads and the `contract`, `self-check` and `windows-smoke` status checks (strict). It
  requires zero approvals, and the admin role can bypass it by pull request. `self-check` is a transitional
  duplicate of `contract`; `windows-smoke` runs `npm run check`, `npm test` and the scaffold smoke on Windows
  only. `BranchProtection` verifies deletion, force-push and pull-request rules, the `contract` context (and
  `required`, where the CI workflow defines that job) and thread resolution for every consumer. It does not inspect bypass actors.
- **Tags move only within a major**. The floating `v<major>` tag (`v0` while 0.x) is derived from the version
  being released; a 2.0.0 release creates `v2` and never moves `v1`. The tag ruleset forbids updating or
  deleting `v*.*.*` tags; the floating tag is outside it and can be moved by anyone with write access.

## What this repository enforces on itself, and what it enforces on consumers

This repository runs 30 checks on itself through `npm run contract` (`scripts/run-contract.mjs` against
`repo-contract.config.ts`). Among them:

- dependency vulnerability scanning (`SecurityDeps`, `SecurityDevDeps`);
- secret scanning (`SecuritySecrets`);
- supply-chain review (`SecuritySocket`);
- branch protection on `main`;
- the open alerts of GitHub's default CodeQL setup (`CodeScanning`).

The config lists each of the 25 standard checks it leaves out and why. Every consumer gets the full standard
through `contract.ts` (README, "The checks"). The secrets the workflows here read are `PIN_SYNC_TOKEN` (pin
sync) and `SOCKET_SECURITY_API_KEY` (the `socket` CLI during the contract); shipped code reads neither.

### Known limits of those checks

- **`SecuritySocket` scores the version that is already published**. A dependency added in a release pull
  request is first scanned after it ships. The pre-publish gates are `SecurityDeps`, `Licenses` and
  `DistNoUrls` on the exact tree being released. Here it passes by skipping: the package is private.
- **`SecurityDeps` audits production dependencies** (`npm audit --omit=dev`). The published packages have none,
  so for them it is vacuous. The exposure that matters is the development tooling. It is covered by
  `SecurityDevDeps` (a critical advisory fails, lower ones warn) and Dependabot.
- **`CodeRabbit` runs where its CLI is installed**. In CI the review is the GitHub App's. Its findings gate a
  merge through required review-thread resolution on the ruleset, not through the CLI.
- **`CodeScanning` reads the alerts of the ref being built**. An alert open on `main` only is invisible to a
  pull request.

## Supported versions

Only the latest release is supported; there is no long-term-support branch. This is policy, not a mechanism.
