# internal-package-contract

## 0.13.1

### Patch Changes

- fb9d697: The shared release workflow checks the published version with `npm view --prefer-online`, each query bounded to 20 seconds and the whole wait to a ten-minute deadline: `npm view` otherwise answered from npm's own cache, which still held the package from before the publish, so data-cap 0.8.0's release was marked failed although npm served it. `displayPath` keeps a file inside the root whose folder or name starts with two dots (`..cache/x.ts`) relative. A benchmark report also cuts a path that follows `=` or `key:` from a failure's message, and escapes a `|` (and any backslash before it) in the failed-measurement cell so it cannot add a column. The README's `CodeRabbit` row names every case in which the check still fails. The shared `no-node-fs` rule also reports `node:fs` named by a template literal with no `${}` and loaded through `process.getBuiltinModule`, and the shared tsconfig loader reads the config through the filesystem it is handed and reports what the compiler rejects in it (still using the paths that parsed) instead of ignoring it, and a config it cannot read as a warning too. The re-exported packages move to `@maverickcer/env-cap` ^0.7.0 and `data-cap` ^0.8.0, the scaffolded and shared workflows pin setup-node v7.1.0, upload-artifact v7.0.2 and download-artifact v8.0.2, and dev tooling takes Dependabot's pending updates. A benchmark report no longer presents an overhead the run could not measure as zero: when the package's median is not above the baseline's, the summary says no overhead was measured and the throughput ceiling is "not measurable" instead of an infinite figure.

## 0.13.0

### Minor Changes

- b3bf6ec: The `CodeRabbit` check is advisory: its findings are suggestions to adopt where they improve the code, listed as a warning, never a reason to stop a commit. A review of the same diff words its findings differently on every run, so a record keyed by the wording could never be relied on to match the next review, and the check could not pass on a large change. A review that cannot be read warns too; a broken `.repo-contract/exceptions/coderabbit.json` still fails. On a pull request, CodeRabbit's GitHub App review and review-thread resolution are unchanged.

## 0.12.0

### Minor Changes

- 49c9641: feat(adoption): a package that adopts the standard starts in adoption mode, where every failing check is a warning until it is promoted; `adopt` now adds every config, script and template the package lacks
- 49c9641: feat(skill): `skill [--check]` writes a package's agent skill (`skills/<name>/SKILL.md` within a word budget, and `references/api.md`) from `package.json`, `docs/surface.json`, the API baselines and the few things the author writes in `docs/skill.json`; the optional `AgentSkill` check fails on a stale or invalid skill
- 49c9641: feat(benchmark): require every parameter and key of every public function to be benchmarked or accounted for, and measure a second variable on its own (`BenchmarkCoverage`, `covers`, `sweeps`)
- 49c9641: feat(contract): build the benchmark page before the checks when the package defines `docs:benchmarks`, so the link check behaves the same locally and in CI
- 49c9641: feat(report): `report` writes what a change does to the package as Markdown to paste into a pull request, from git, the changesets, the exception registries, the decision records, the manifest and the contract's last report
- 49c9641: feat(clean-checkout): the `CleanCheckout` check type-checks only what git tracks (the index, so staged files count), in a temporary copy with this installation's dependencies linked, so a file hidden by `.gitignore` or never added fails on the machine that has it and not only in CI
- 49c9641: fix(mutation): a mutant that times out is run again alone before it counts, so a stalled machine is not reported as a loop, and the reuse of an earlier run keeps only a run in which every mutant was caught or left out
- 49c9641: feat(badges): every published figure says what it is. The coverage badge reads "lowest of 4" and `coverage.json` beside it gives all four measures (lines, statements, functions, branches) with what each counts; the mutation badge says "detected of applicable" and `mutation.json` gives the count of each status; the size badge shows the size against its budget, with `size.json`. `tool badges` takes `--coverage <file>` and `--no-size`, so a package with its own coverage aggregate uses it instead of keeping a copy of the generator
- 49c9641: feat(benchmark): a benchmark run outside CI writes to `.benchmark-local/<suite>/`, which is never committed, and the checks read it in preference to the committed results; only CI's figures are committed and published
- 49c9641: feat(docs): keep the shared process documents (code of conduct, support, releasing) current in every package, and scaffold them in full
- 49c9641: Take any check apart and put it back: `internal-package-contract/checks/parts` splits a check into its evidence and its policy (`evidenceOf`, `policyOf`, `composeCheck`, `withEvidence`, `withPolicy`, `evidenceOfAll`, `policiesOfAll`). The evidence scripts (`./scripts/*`) and the shared runtime modules (`./runtime/*`) are now exported directly, and an IPC benchmark suite covers the new exports.

  `internal-package-contract/logs` re-exports repo-contract's `onEvidenceSaveToRepoContractLogs` and `onVerdictPrependRepoContractLogs` (and `repoContractLogs`), so a package that runs its own contract gets the one-log-per-check hooks without installing `repo-contract`. The contract run itself now uses them, and prints a failure as soon as its verdict exists. Needs `repo-contract` 0.11.0 or later.

  `env-cap` and `data-cap` are now dependencies of this package, and every entry point is exported (`internal-package-contract/env-cap`, `/env-cap/build`, `/data-cap`, ...), so a package that uses this one installs neither itself. A new `env` command documents the credentials and settings a package depends on from `ci/env.schema.ts` into `docs/ENVIRONMENT.md`; a new `EnvContract` check warns (never fails) about a credential that is expiring or expired and a document that is out of date; `init` scaffolds the contract, the `docs:env` script and a weekly `env-rotation.yml` workflow (managed by `sync`) that opens one issue when a credential is due; and `doctor` reports it. Nothing in it is required: a package with no contract passes. A missing Socket API key is now a warning in CI as well as locally.

- 49c9641: feat(mutation): `mutation [--base <ref>] [file...]` mutation-tests what a change touched, and the source files the changed tests import, as a fast loop while writing: every mutant of those files, never an earlier result, under the package's own concurrency; it is advice, and the full `Mutation` check stays the gate
- 49c9641: feat(mutation): a mutation run over inputs that have not changed in any way is not run again: the evidence of the last clean run for the same hash of every file git does not ignore (and of the Node.js version) is put back for the check to judge, never under CI; `IPC_MUTATION_MEMO=0` runs it regardless

  The `Mutation` check also always runs every mutant (`--force`), ignoring any incremental file, so a result carried over from a run made under other conditions can no longer stand in for a cold run.

- 49c9641: feat(benchmark): remove the per-benchmark regression threshold, and warn when a function's big-O cannot be determined
- 49c9641: feat(setup): one command to adopt this standard in an existing package or start a new one, with `adopt`, `setup` and a read-only `doctor` that lists what is left
- 49c9641: feat(tools): run the size, badge, API-report, CommonJS-interop and compiler-isolation helpers from here, add an optional AmbientCapabilities check with `add check`, and keep more of the files every package shares current
- 49c9641: feat(env): the standard ships the contract for what it reads from the environment, and `env` includes it in every package's `docs/ENVIRONMENT.md`; the scaffolded `ci/env.schema.ts` no longer repeats it, so the explanation lives in one place and cannot drift
- 49c9641: fix(git-hygiene): `GitHygiene` fails on an import in tracked source that resolves only to a file git does not track, which is how a `.gitignore` pattern that was too wide hid source from every clean checkout while every local check passed
- 49c9641: feat(upgrade): `upgrade <tag>` moves a package to a release and updates the pin, workflows, managed files, landing page and benchmark guides in one step
- 49c9641: feat(verify-consumers): `verify-consumers <checkout>...` runs each dependent package's fast offline checks with the standard it has installed and with this one, in throwaway copies, and names every check that got worse; it also says where an install would add its own copy of a package the standard depends on

### Patch Changes

- 49c9641: fix(runtime): recognise a generated file only by a marker that opens a comment, so code or prose that quotes the marker is not taken for one
- 49c9641: fix(tests): tests start without the variables a git hook supplies (the repository, the settings and the author of the commit being checked), so they no longer fail under a hook that passes by hand or run git against the real repository
- 8ac8b1f: The shared `no-node-fs` rule also reports `node:fs` reached through a re-export (`export ... from`, `export * from`) or TypeScript's `import x = require()`, and matches an `allow` pattern written relative to the working directory (`src/cli/**`) against the absolute path ESLint gives it, on Windows too, and when the working directory is a filesystem root; the matching is the shared `glob` copy's new `matchesAllowList`, so a package's own lint rules can use the same. A benchmark report shows only the first line of a failure's message, with every absolute path in it cut to its file name, so a stack trace and the paths of the machine that ran it stay out of the published page. WRITING-BENCHMARKS.md records the two exceptions suites already use (a per-function `tiers` with its `tiersReason`, and benchmarking internal source), and the scaffolded and environment-rotation workflows pin the same v7 checkout, setup-node and upload-artifact actions as the rest. This package's own release works again under Changesets 3, which stopped versioning a private package unless `privatePackages.version` is set: the Version Packages pull request for this release could not be opened without it.
- 49c9641: fix(benchmarks): give each category's package-cost heading its own id, and say in the reading guide that a worse growth class is a third failing gate
- 49c9641: A mistyped command now stops with a suggestion instead of starting the whole contract. `isGeneratedFile` in the shared runtime reads only the first twenty non-empty lines instead of splitting the entire file, so its cost no longer grows with the file; packages pick it up with `sync --apply --update`.

## 0.11.0

### Minor Changes

- 2410ab9: Bump `repo-contract` to 0.10.0.
- 7291bdd: The `typescript` dependency moves from 5.9 to 6.0. It is the compiler API IPC's own checks load, so consumers resolving it through IPC now get TypeScript 6.

### Patch Changes

- b316933: This repository's own release workflow no longer tags a version before it is merged. While changesets were pending it read the version the Version Packages step had just bumped in its working tree, tagged the unmerged release-branch commit with it and moved the floating major tag there (v0.9.1 and v0 pointed at a commit that never reached main). It now tags only when there is nothing left to version, and tags the commit the run is for.

## 0.10.0

### Minor Changes

- 23125f7: TypeScript 7 (the native compiler) is now part of the standard. The scaffolded `contract.yml` gains a `typescript-7` job that type-checks the package with the TypeScript 7 compiler while the development toolchain stays on TypeScript 5 or 6 (typescript-eslint, typedoc and API Extractor need the compiler API TypeScript 7 does not ship), and this repository's own CI runs the same check. Delete the job from a package that cannot type-check under TypeScript 7 yet.

### Patch Changes

- 30965ef: The ApiContract check now accepts a package version that has already reached the minimum the API diff requires. A release pull request has consumed its changesets and bumped `package.json`, so it has no changeset left to declare the level; the check used to fail it for exactly that, even though the bump was already applied.
- 5049e93: The benchmark kit's sampling test no longer assumes a timer finer than the platform's, so it stops failing intermittently on Windows, where a 2 ms timer fires about every 15 ms.
- 0de6552: The shared Stryker baseline now runs one worker. With several, tests that spawn processes contend for CPU: they time out and count as kills while other mutants lose their attributed runs, so the survivors differ from run to run and a full run is slower, not faster. A consumer with a purely synchronous suite can raise `concurrency`.

## 0.9.0

### Minor Changes

- 42eec17: Make the standard enforceable and honest ahead of 1.0.

  - Contract: `standardChecks()`, a `Suppressions` check (inline disables/ignores need a record), a dev-tooling audit, a skipped-tests registry, a required-status-checks `BranchProtection` check, and an exceptions inventory with `--skip`/`--strict`, durable run reports and recorded environment degradations.
  - Exceptions: v2 records (owner, expiry, review, scope, rationale and more), `policy-rule` methods, widened Socket types, legacy v1 tolerance.
  - Mutation always runs, reports ignored mutants, and covers the exception matcher; the harness runs the full suite.
  - Benchmarks: same-run ratio gates, asymptotic fit with R², an accessible server-rendered history page, a post-merge record job and no bot commits into pull requests.
  - Release: a split version/build/publish pipeline, npm pinned, a floating `v<major>` tag, workflows pinned by commit SHA and re-pinned with the dependency; nothing automated can publish `1.0.0`.
  - Accessibility scans every section and each kind of API page; `ApiContract` targets come from `package.json` exports.
  - IPC now holds its own scripts and checks to the standard (coverage, CRAP, duplication, architecture), and depends on `repo-contract` as `~0.8.8`.
  - `TOOLKIT.md`: how the four packages relate, and a glossary.

## 0.8.1

### Patch Changes

- 462c0af: Let this repository's own CI be started on demand (`workflow_dispatch`), so the dependency-pin sync can run it on the pull requests it opens with its own `GITHUB_TOKEN`, which GitHub does not run CI for by itself.
- 260f1d2: Bump `repo-contract` to 0.8.8.

## 0.8.0

### Minor Changes

- 1ec31a0: Replace the cross-repository release dispatch (and the `CROSS_REPO_PAT` secret that expired) with a pull. The shared `dependency-pin-sync` workflow now takes optional inputs, opens no PR when the pin is already current or a PR for it already exists, derives the changeset severity from the version change, and is called from daily `schedule` triggers (plus manual `workflow_dispatch`) using each repo's own `GITHUB_TOKEN`. The "Notify dependents" release step and `consumers.json` are removed, and the scaffolded `sync-internal-package-contract.yml` is the pull-based one. The package and the `init` scaffold now override `adm-zip` to 0.6.1, which clears its published advisories (reached only through `github-actionlint`), and the README explains that consumers must add the same override themselves.

## 0.7.0

### Minor Changes

- 793571b: Add the local-only `CodeScanning` check. It reads the repository's open GitHub code-scanning alerts with your own `gh` login (a no-op in CI) and judges each by where it is: an alert in code that builds, runs or ships must be fixed and cannot be waived; an alert in development-only code (tests, unpublished `scripts/`, docs, examples, benchmarks, `.github/`, `*.config.*`) is rejected with a standing, auto-written record in the git-ignored `.repo-contract/exceptions/code-scanning.json` (the only accepted `exceptionType` is the new `dev-only-not-shipped`). `init` now ignores that registry. The shared workflows and the scaffolded `contract.yml` no longer use any npm or action caches, and the Socket-score `actions/cache` step is gone, because a cache written by a workflow that runs pull-request code can be poisoned (CodeQL `actions/cache-poisoning`). Also fixes the incomplete tag sanitization in `check-docs-fragments.mjs`.

## 0.6.0

### Minor Changes

- c50bc27: Spend Socket quota sparingly. The CLI now runs `SecuritySocket` last and only when every other check passed (otherwise it prints `[SKIPPED] SecuritySocket`), and the score script caches successful scores per `<package>@<version>` for 24 hours (`IPC_SOCKET_CACHE_DIR`, `IPC_SOCKET_CACHE_TTL_HOURS`, `IPC_SOCKET_CACHE=off`); the scaffolded `contract.yml` persists the cache with `actions/cache`. The shared `dependency-pin-sync` workflow also now handles git-sourced dependencies (`github:owner/repo#main`) by re-resolving the branch head instead of running `npm install name@version`, which cannot resolve for a package that is not on npm.

## 0.5.0

### Minor Changes

- 0d1e90a: `SecuritySocket` now waives supply-chain-risk alerts instead of forbidding them: every alert below `critical`/`high` needs a finding-specific record with all five fields fully written (`justification`, `alternatives`, `remediation`, `method`, `exceptionType`), and the only accepted `exceptionType` is the new `required-for-package-to-exist` -- the flagged dependency or behavior is why the package exists. Critical and high alerts stay forbidden.

### Patch Changes

- d93a0c9: Key `SecuritySocket` exception records for the scored package's own alerts by the stable word `self` instead of its version (`socket:<name>@self:<alert>`), so a release no longer orphans every record and fails the next run. Alerts on dependencies keep their `package@version` ids.

## 0.4.0

### Minor Changes

- 3f23d64: Adds a shared benchmark engine (`scripts/benchmark/`) generalizing the tiered
  benchmark + committed history + PR-comment summary + Pages history chart
  methodology env-cap and data-cap each independently built.

  - `append-history.mjs`: appends a compact entry to a consumer's committed
    history file. History schema v2 carries each tier's full `inputs` object
    through (not just a derived throughput figure), plus a generic
    `unitsPerSecond` and a `versions` object copied from the run's own
    metadata. Old (schema v1) history entries remain valid as-is.
  - `classify-complexity.mjs`: infers an algorithmic complexity class
    (`constant` through `exponential-or-worse`) per benchmark group from its
    tiers' `{ medianMs, inputs }`, and flags a **complexity shift** when the
    inferred class changes since the last recorded run -- a stronger, machine-
    independent signal than an ordinary regression-percent budget breach.
  - `render-summary.mjs`: renders the highlight-only PR-comment summary,
    leading with complexity-shift flags ahead of budget-breach highlights.
  - `render-page.mjs`: builds a static `docs/benchmarks/index.html` history
    page (small-multiples line charts per group, complexity-class annotated,
    bounded to the most recent ~200 entries), generated fresh on deploy and
    never committed.
  - `.github/workflows/benchmark-pr.yml`: reusable `workflow_call` workflow
    consolidating env-cap's and data-cap's near-duplicate `benchmark-pr` CI
    job, now calling into the scripts above.

  Consumers adopt this via three thin npm scripts
  (`benchmark:history`/`benchmark:summary`/`benchmark:page`) that forward to
  this package's own scripts -- see the README's new "Shared benchmark engine"
  section. Actually rewiring env-cap's and data-cap's own `package.json`/CI
  onto this engine is a separate follow-up.

- 24e4367: Make the package the strict foundation for every consumer. Adds the `NoMinify` and `DistNoUrls` checks (the latter reconciled through an exceptions registry and built on `repo-contract/presets`'s `distNoUrls`), rewrites `SecuritySocket` on `socket package score` so it fails whenever Socket cannot run and prints CI-vs-local setup steps, adds `init --name/--owner/--description` that scaffolds a complete package, and ships the self-contained benchmark kit (`internal-package-contract/benchmark`, `run-suite.mjs`, the `WRITING-BENCHMARKS.md` / `READING-BENCHMARKS.md` docs) with a generalized `benchmark-pr.yml`. Requires `repo-contract` 0.8 or newer. Breaking while 0.x: consumers need the new checks' exception records and a Socket API key in CI.

### Patch Changes

- bd87e5d: Fixes `Crap`: `@danibram/crap4ts`'s own CLI calls `process.exit()` immediately
  after an un-awaited `process.stdout.write()`, which can terminate the process
  before a large report (hundreds of functions) finishes draining through the
  OS pipe's own backpressure -- silently truncating captured stdout and making
  this check fail with "crap4ts output could not be parsed as JSON" on an
  otherwise-healthy run. Confirmed to reproduce on an unmodified checkout,
  independent of any consumer's own source, once a consumer's function count
  grows large enough to push the report past the pipe's buffer size.

  `Crap` now passes `--output reports/crap.json` and reads that file directly
  instead of relying on captured stdout -- a regular file write isn't subject
  to the same backpressure race, so this sidesteps the bug at the call site
  rather than depending on an upstream fix.

- 1728fbc: Accept npm 12's `npm pack --json` output (an object keyed by package name) as well as the older array form in the shared `arethetypeswrong` runner, which every consumer's contract uses.

## 0.3.0

### Minor Changes

- 00697c0: Adds the `ApiContract` engine as a new bundled check (`contract.ts`'s own
  `ApiContract`, exported for external consumption at
  `internal-package-contract/checks/api-contract`): diffs every consumer target's
  real, current public API (API Extractor diffing + TypeChecker assignability
  probing, generalized over the consumer's own `typedoc.json` entry points)
  against its committed baseline, and fails when the branch's Changesets
  under-declare the resulting semver bump. Ported from `repo-contract`'s own
  previously-duplicated `checks/api-contract.ts`, adapted for a
  Changesets-declared bump instead of a Conventional-Commits-declared one, and
  for a consumer with several independent public entry points instead of one.

  Also adds two smaller writer checks to `contract.ts`: `ApiDocsReport` (keeps a
  consumer's committed `docs/api-report/` in sync with `docs:api:report`) and
  `ReadmeExample` (keeps a consumer's README example prose in sync with its own
  example CLI output, skipped when the consumer defines no
  `verify:readme-example` script). `internal-package-contract/checks/npm-script`
  (the generic `npmScriptCheck` factory both of these -- and `ApiDocsReport`
  specifically -- are built from) is now exported too, so a consumer with its
  own bespoke contract config (like `repo-contract`) can compose the same
  building block directly instead of duplicating it.

- 6555ffa: Adds a new reusable `api-baseline-sync.yml` workflow: regenerates a consumer's
  committed `ApiContract` baseline (`.repo-contract/api-contract/*/baseline.*`)
  on its Changesets "Version Packages" PR branch, via `npx internal-package-contract
update-baseline`, and commits it back -- the generic counterpart to the
  bespoke `api-baseline.yml` every consumer used to hand-roll around its own
  `contract:baseline` script. Also adds `repo-contract` to `consumers.json`,
  so it now receives a dependency-pin-bump PR on future releases like every
  other consumer.

## 0.2.2

### Patch Changes

- 5c18493: `release-npm-changesets.yml` now dispatches the consumer's own `ci.yml` on the release PR's branch
  right after `changesets/action` creates or updates it. `changesets/action` pushes that branch with
  the default `GITHUB_TOKEN`, which GitHub deliberately never lets trigger `push`/`pull_request`-based
  workflows (an anti-recursion guard) -- confirmed directly against real Release PRs across two
  consumers this session, each sitting with zero CI checks until a human manually pushed a real commit
  to unstick it. `gh workflow run` is explicitly exempted from that restriction, and its run's checks
  attach to the branch's head SHA exactly as a normal `pull_request` run's would, so a consumer's
  required status checks are already green by the time a human reviews the PR.

## 0.2.1

### Patch Changes

- a919691: Fixes `release-npm-changesets.yml` (the reusable workflow consumers like
  `data-cap`/`env-cap` call for their npm-publishing releases) to give
  `changesets/action` a Conventional-Commits-compliant commit/PR title
  (`chore: version packages` instead of the default `"Version Packages"`).
  A consumer's own `commits` check (bundled from this package) was failing
  the resulting bot commit on `origin/main..HEAD` for exactly this reason,
  confirmed directly against a real Release PR. This is the reusable
  workflow's counterpart to the same fix already applied to this repo's own
  non-publishing `release.yml` in #11.

## 0.2.0

### Minor Changes

- c001355: Adds a new `BranchProtection` check (28 total) plus init-time GitHub ruleset
  setup -- `internal-package-contract init` now idempotently configures the
  default branch to block deletion, block force-pushes, and require every
  merge to go through a pull request, and the same state is verified on every
  `npm run contract` going forward. Fixes the self-contract Mutation
  regression in `checks/coverage.ts`. Adds `CODEOWNERS`/`SECURITY.md`/
  `CONTRIBUTING.md` templates (scaffolded by `init`, and adopted by this repo
  itself). Fills in missing `package.json` metadata (`repository`, `homepage`,
  `bugs`, `author`, `keywords`). Drops the `.`/`./contract` exports map
  entries, which never worked from a real installed `node_modules` tree and
  nothing in the fleet used -- the CLI is the one supported entry point. Adds
  a Windows CI leg for `bin/init.mjs`'s path/file-I/O and git-hook wiring.
  Hardens four checks (`coverage`, `accessibility`, `github-actions`,
  `mutation`) to give clear, actionable results for a genuinely brand-new
  consumer package instead of a vague failure or a false pass. Fixes a
  pre-push hook bug where an absolute-path `file:` dependency's symlink could
  make a consumer's `git push` run this repo's own self-tests instead of its
  own.
