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
2. Write the test first (see "Test first" below), then the change.
3. `npm run contract` locally before opening a PR.
4. Open a PR. CI re-runs the same contract; merge once it's green.

## Test first

A change in behavior starts with a test:

1. Write the smallest test that specifies the next behavior, and run it. It has to fail, and for the
   reason you expect. A bug fix starts with a test that reproduces the bug.
2. Write only enough code to make it pass.
3. Refactor with the suite green, then repeat.

Tests specify observable behavior and its boundaries, not how the code is built. State the rule once
at the suite level, and in an ADR when the reason is architectural, rather than repeating it in every
test name.

CI enforces that the tests pass and that coverage, mutation and lint hold. It cannot show which was
written first, so a bug fix, new behavior or security change says in its PR description which test
failed first. A documentation-only change does not need this.

## Releasing

Releases are [Changesets](https://github.com/changesets/changesets)-driven, not a manual,
developer-machine step -- see this repo's own `.github/workflows/release.yml` and, if one exists,
`RELEASING.md`, for the exact flow.
