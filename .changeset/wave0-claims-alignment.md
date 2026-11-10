---
"internal-package-contract": minor
---

Gates that could pass without looking now say so, and the documentation matches what the checks do.

- `SecuritySocket` without an API key is a degradation (`environment:SecuritySocket:no-key`): a warning locally, and in CI, where the contract runs `--strict`, a failure unless `.repo-contract/exceptions/environment.json` records it. `init` writes that record with a 90-day expiry, so a new package is green on day one and decides about a token before the record lapses. A rejected token, a network error or a rate limit still fails outright.
- `CodeScanning` no longer passes when the alerts could not be read: a repository with no code scanning enabled, or no GitHub remote, is a degradation (`environment:CodeScanning:not-enabled`, `environment:CodeScanning:no-remote`).
- The shared release workflow's build job proves that a workflow run on a commit with exactly the released tree finished its `contract` job with success, instead of trusting the merge; it does not run the contract again. `check-packed-consumer --strict` now exits non-zero when the tarball cannot be installed, so the release build job fails on it.
- The scaffolded `contract.yml` gains a `required` job that runs `if: always()` and fails unless every other job finished with success, and `init` requires both `contract` and `required` in the default branch's ruleset, each pinned to the GitHub Actions app so a check of the same name from another app cannot satisfy it.
- Adoption mode no longer suspends `--strict`: a promoted check that could not run and has no exception record fails the run while the package is adopting, as it will afterwards; unpromoted checks stay advisory.
- `BranchProtection` also requires the required-status-checks rule to be strict (a branch up to date with its base before it merges), as `init` has always configured it and SECURITY.md has always said.
- The `eslint` baseline gains `ipc/no-network`: nothing under `src/` imports a network module or uses a network global; type-only imports are allowed.
- New managed copies: `ci-jobs` and `ci-jobs-test` (a test that every job of `ci.yml` is waited for by the `required` job) and `vm-bundle` (runs a browser bundle in a `vm` context with no Node globals).
- `update-baseline` updates the surface baseline of a package with no `typedoc.json` instead of failing to read it; this repository's own contract now runs `SurfaceContract`, `CodeScanning`, `EnvContract` and `GitHooks` as well, and `repo-contract.config.ts` lists every standard check it leaves out and why. Region markers inside a fenced code block are an example, not a region.
- This repository's own release installs with `--ignore-scripts`, like the rule it imposes on consumers, and the pin-sync workflow dispatches `contract.yml` when a consumer has no `ci.yml`.

Documentation: `SecuritySocket` and the pre-commit hook (`--scope affected`) are described as they behave; `ManagedFiles` names all five files it manages; EXCEPTIONS.md lists every registry and degradation code; stale version numbers, dates and the dependabot comments about TypeScript 7 and Changesets are corrected. The consumer template says Node 22, starts at TypeScript `^6.0.3` and Changesets CLI `^3.0.3`, and no longer blocks Changesets majors in dependabot.
