# Contributing

## Before you start

- `npm ci`, then `npm run contract` -- this is the same check that runs in CI and pre-push; if it
  passes locally, CI should pass too.
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/) (enforced by
  commitlint on `commit-msg`); `git commit` picks up `.gitmessage` as a template once
  `internal-package-contract init` has run.
- Every change lands through a pull request -- the default branch is protected (see
  `internal-package-contract init`'s branch-protection setup) and cannot be pushed to directly.

## Making a change

1. Branch from the default branch.
2. Make the change; add or update tests alongside it.
3. `npm run contract` locally before opening a PR.
4. Open a PR. CI re-runs the same contract; merge once it's green.

## Releasing

Releases are [Changesets](https://github.com/changesets/changesets)-driven, not a manual,
developer-machine step -- see this repo's own `.github/workflows/release.yml` and, if one exists,
`RELEASING.md`, for the exact flow.
