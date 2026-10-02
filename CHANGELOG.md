# internal-package-contract

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
