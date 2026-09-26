# Contributing

## Before you start

- `npm ci`, then `npm run contract` -- this is the same check that runs in CI and pre-push; if it
  passes locally, CI should pass too.
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/) (enforced by
  commitlint on `commit-msg`).
- Every change lands through a pull request -- `main` is protected (deletion blocked, force-pushes
  blocked, merges require a PR) and cannot be pushed to directly.
- Changes meant to ship in the next version need a changeset: `npx changeset` (see "Releasing"
  below).

## Making a change

1. Branch from `main`.
2. Make the change; add or update tests alongside it.
3. `npm run contract` locally before opening a PR.
4. Open a PR. CI re-runs the same contract; merge once it's green.

## Keeping `contract.ts` in sync with `repo-contract`'s own config

`contract.ts` is a hand-maintained clone of `repo-contract`'s own `repo-contract.config.ts` (see
that file's own doc comment for exactly what is and isn't cloned) -- an improvement or a new check
upstream in `repo-contract` does **not** propagate here automatically. Re-diff the two whenever
bumping the `repo-contract` dependency version in `package.json`, and bring over anything relevant.

## Releasing

Releases are [Changesets](https://github.com/changesets/changesets)-driven. Add a changeset
(`npx changeset`) describing the change and its semver bump alongside the PR that introduces it;
merging the automated "Version Packages" PR that accumulates is what actually bumps
`package.json`/`CHANGELOG.md` and tags a release (see `.github/workflows/release.yml`). This
package is never published to npm (see README/SECURITY.md), so "release" here means a version bump,
a CHANGELOG entry, and a git tag only -- no `npm publish` ever runs.
