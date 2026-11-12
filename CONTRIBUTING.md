# Contributing

## Before you start

- `npm ci`, then `npm run contract`: the full gate CI runs on a push to `main` (`.github/workflows/ci.yml`,
  `npm run contract -- --scope auto`). Pre-push runs it without Coverage, Crap and Mutation; a pull request runs
  the subset the change can reach (`--scope auto`), and Coverage is "not evaluated" there. The full run is the
  push to `main` after the merge, so a pull request whose change touches no mutated file can merge and go red on
  `main`.
- The hooks are this repository's own `hooks/` directory, pointed at by `core.hooksPath`; a fresh clone sets
  that with `node bin/contract.mjs install-hooks`. They are a convenience: CI is the gate.
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/) and carry no
  `Co-Authored-By` trailer; commitlint on `commit-msg` and the `Commits` check reject both
  (`config/commitlint.config.mjs`; `test/commitlint-baseline.test.ts`).
- Every change lands through a pull request. The `main` ruleset blocks deletion and force-pushes, requires a
  pull request with resolved review threads and zero approvals, and requires the `contract`, `self-check` and
  `windows-smoke` status checks, strict. `self-check` is a transitional duplicate of `contract`. `windows-smoke` runs
  `npm run check`, `npm test` and the scaffold smoke on Windows, not the full contract. `typescript-7` is advisory. The admin role can bypass by pull request.
- Changes meant to ship in the next version need a changeset: `npx changeset` (see "Releasing").

## Making a change

1. Branch from `main`.
2. Write the test first (see "Test first"), then the change.
3. `npm run contract` locally before opening a pull request.
4. Open a pull request. CI re-runs the same contract; merge once it is green.

## Test first

A change in behavior starts with a test:

1. Write the smallest test that specifies the next behavior, and run it. It has to fail, and for the reason you
   expect. A bug fix starts with a test that reproduces the bug.
2. Write only enough code to make it pass.
3. Refactor with the suite green, then repeat.

Tests specify observable behavior and its boundaries, not how the code is built. State the rule once at the
suite level, and in an ADR when the reason is architectural, rather than in every test name.

CI enforces that the tests pass and that coverage (`vitest.config.ts`: 80% for each of four measures over
`checks/`, `runtime/`, `scripts/` and `bin/`), mutation (zero survivors, `stryker.config.mjs`) and lint hold. It
cannot show which was written first, so a bug fix, new behavior or security change says in its pull request
which test failed first. A documentation-only change does not need this.

## One standard, not two copies

The standard lives once, in `checks/` (`checks/standard.ts`'s `standardChecks()` is the map of every check).
`contract.ts` wraps it for a consuming package, and `repo-contract`'s own self-contract composes the same map,
overriding only what it must. When you change a check, you change it for every package; when `repo-contract`
needs something different, make it an explicit override there, with a reason, not a fork.

## Adding a check

A check is one file, one registration and one test.

1. **Write it** in `checks/<kebab-name>.ts` as a factory, `camelName(): CheckDefinitionConfig`, with two parts:
   `run`, the argv of the tool (named by its bin, so the tool must be a dependency of this package), and
   `policy({ result })`, which turns the tool's output into `{ outcome, rationale }`. Policy decides pass or
   fail; the tool's exit code is evidence. Reuse `abnormalTermination`, `combinedOutput` and `resolveConfig` from
   `checks/shared.ts`. A rationale says what was checked and what to do next; repo-contract rejects vague ones
   (its ADR 0016).
2. **Keep the scan path in the second slot.** A check that scans the source tree writes `run` as
   `[tool, "src", ...flags]`. This repository has no `src/`; `repo-contract.config.ts` retargets that slot at the
   trees named in `scope.mjs`, so another shape breaks self-hosting.
3. **Register it** in `checks/standard.ts` under a PascalCase id. Declaration order is the schedule: writers
   first, then the `Build` barrier, then readers. `contract.ts` picks it up from there; `repo-contract.config.ts`
   lists its checks explicitly, so add it there too if it applies to this repository.
4. **Test it** in `test/<name>.test.ts`, modeled on `test/docs-markdown.test.ts`: build a context with
   `makeContext` and `makeResult` from `test/support.ts`, point `process.cwd()` at a temporary directory, and
   assert the exact `outcome` and `rationale`. Cover each branch of the policy and each way `run` is built;
   `Mutation` requires it.
5. **Document it**: add a row to the matching phase table under "The checks" in the README, and update the id
   list in `test/contract.test.ts`, which pins the ids.
6. **Run it**: `npm run contract -- --checks YourCheck` while developing, then the full `npm run contract`. Add
   a changeset: a new blocking check changes the standard for every package, so choose the bump deliberately.

Every `eslint-disable` must give a reason, name a rule, close itself, be unique and still be needed
(`eslint.config.mjs`); Stryker and v8 comments are covered by `Suppressions`.

## Releasing

Releases are [Changesets](https://github.com/changesets/changesets)-driven. Add a changeset (`npx changeset`)
alongside the pull request that introduces the change. Merging the "Version Packages" pull request bumps
`package.json` and `CHANGELOG.md` and tags a release through `.github/workflows/release.yml`, which installs with
`--ignore-scripts`, runs `npm run version` and creates a GitHub Release. This package is never published to npm,
so a release is a version bump, a CHANGELOG entry and a git tag; no `npm publish` runs.

Tag scheme: every release is tagged `v<major>.<minor>.<patch>`, and the floating `v<major>` tag (`v0` while
0.x) moves to the newest release of that major, never across a major. The tag ruleset forbids updating or
deleting `v*.*.*` tags but not creating one, so never push a stray local tag (`git push --tags` would create it).
Consumers pin a release tag, or the commit it points at (see SECURITY.md).
