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

## One standard, not two copies

The standard lives once, in `checks/` (`checks/standard.ts`'s `standardChecks()` is the map of every
check). `contract.ts` wraps it for a consuming package, and `repo-contract`'s own self-contract
composes the same map -- overriding only what it must and adding what is its alone -- so a fix to a
check lands once and "a MaverickCER package" means one thing. When you change a check, you are changing
it for every package; when `repo-contract` needs something different, make it an explicit override
there (with a reason), not a fork.

## Releasing

Releases are [Changesets](https://github.com/changesets/changesets)-driven. Add a changeset
(`npx changeset`) describing the change and its semver bump alongside the PR that introduces it;
merging the automated "Version Packages" PR that accumulates is what actually bumps
`package.json`/`CHANGELOG.md` and tags a release (see `.github/workflows/release.yml`). This
package is never published to npm (see README/SECURITY.md), so "release" here means a version bump,
a CHANGELOG entry, and a git tag only -- no `npm publish` ever runs.

Tag scheme: every release is tagged `v<major>.<minor>.<patch>`, and the floating `v<major>` tag
(`v0` while this is 0.x) is moved to the newest release of that major -- never across a major
boundary. Consumers pin a release tag, or better the commit it points at (see SECURITY.md).
