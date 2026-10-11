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

## One standard, not two copies

The standard lives once, in `checks/` (`checks/standard.ts`'s `standardChecks()` is the map of every
check). `contract.ts` wraps it for a consuming package, and `repo-contract`'s own self-contract
composes the same map -- overriding only what it must and adding what is its alone -- so a fix to a
check lands once and "a MaverickCER package" means one thing. When you change a check, you are changing
it for every package; when `repo-contract` needs something different, make it an explicit override
there (with a reason), not a fork.

## Adding a check

A check is one file, one registration and one test.

1. **Write it** in `checks/<kebab-name>.ts` as a factory, `camelName(): CheckDefinitionConfig`, with two
   parts: `run`, the argv of the tool (named by its bin, so the tool must be a dependency of this package
   and resolve in every consumer), and `policy({ result })`, which turns the tool's output into
   `{ outcome, rationale }`. Policy decides pass or fail; the tool's own exit code is evidence, not the
   verdict. Reuse `abnormalTermination`, `combinedOutput` and `resolveConfig` from `checks/shared.ts`.
   `resolveConfig` uses the consumer's own tool config when it has one, otherwise a default bundled in
   `config/`. A rationale says what was checked and what to do next; repo-contract rejects vague ones
   such as "see output above" (its ADR 0016).
2. **Keep the scan path in the second slot.** A check that scans the source tree writes `run` as
   `[tool, "src", ...flags]`. This repository has no `src/`, and its own contract
   (`repo-contract.config.ts`) retargets that slot at the trees named in `scope.mjs`, so another shape
   breaks self-hosting.
3. **Register it** in `checks/standard.ts`: import the factory and add it to `standardChecks()` under a
   PascalCase id. Declaration order is the schedule: writers first, then the `Build` barrier, then
   readers. `contract.ts` picks the new check up from there. `repo-contract.config.ts` lists its checks
   explicitly, so add it there too if it applies to this repository.
4. **Test it** in `test/<name>.test.ts`, modeled on `test/docs-markdown.test.ts`: build a context with
   `makeContext` and `makeResult` from `test/support.ts`, point `process.cwd()` at a temporary directory,
   and assert the exact `outcome` and `rationale`. The trees in `scope.mjs` are held to the coverage
   thresholds in `vitest.config.ts` and are mutation-tested (`stryker.config.mjs`), so cover each branch
   of the policy and each way `run` is built.
5. **Document it**: add a row to the matching phase table under "The checks" in the README.
6. **Run it**: `npm run contract -- --checks YourCheck` while developing, then the full
   `npm run contract`. Add a changeset: a new blocking check changes the standard for every package, so
   choose the bump deliberately.

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
