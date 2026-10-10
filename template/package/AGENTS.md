# AGENTS.md

Rules for AI coding agents working in `{{name}}`. They are the same rules a human contributor follows;
[CONTRIBUTING.md](CONTRIBUTING.md) has the reasons.

## Before you change anything

- Run `npm ci`, then `npm run verify`. It type-checks, lints, checks formatting, builds and runs the
  tests with coverage. `npm run contract` runs the full standard and is what CI runs.
- Write the test first and watch it fail for the reason you expect; then write the code. A bug fix
  starts with a test that reproduces the bug.

## Never

- Add a `Co-Authored-By:` trailer to a commit. The commit-msg hook and the `Commits` check reject it.
- Skip a hook or a check (`--no-verify`, a disabled workflow, a lowered threshold). If a gate fails,
  fix the cause; if you think the gate is wrong, say so in the pull request and leave it in place.
- Edit generated files by hand: `docs/api-report/`, `docs/api/`, `dist/`. Change the source and
  re-run `npm run docs:api:report` or `npm run build`.
- Choose a version bump. Add a changeset (`npx changeset`) and leave the bump and the summary for the
  maintainer to set.
- Push to the default branch, tag a release, or publish. Releases are made by the release workflow
  after a human merges the release pull request.

## Conventions

- Commit messages are [Conventional Commits](https://www.conventionalcommits.org/), imperative and
  lowercase, with a header and body lines of at most 100 characters.
- A suppression comment (`eslint-disable`, `@ts-expect-error`, `// Stryker disable`) says why, on the
  same line, in words a reviewer can check.
- Public API is what `package.json` `exports` lists; everything else can change freely.
