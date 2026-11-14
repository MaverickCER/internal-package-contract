# internal-package-contract

## 0.19.0

### Minor Changes

- 307f1c6: `ApiContract` and `SurfaceContract` no longer accept a version bump as the declaration of a change. Before, a package whose version had reached "baseline plus the required level" passed with no changeset. Baselines were never refreshed after a release, so env-cap (baseline 0.6.0, package 0.7.5) and data-cap (0.7.0, 0.10.0) passed every later breaking change. Now:

  - Both checks fail when a committed baseline records another version than `package.json`. The message says to run `internal-package-contract update-baseline` and to add it to the `version` script.
  - The template's `version` script, and this repository's own, run `update-baseline` after the build. The "chore: version packages" pull request then carries the baselines at the new version.
  - Only a changeset at the required level satisfies a diff.

  What to do after upgrading: run `npx internal-package-contract update-baseline`, commit the result, and append `&& internal-package-contract update-baseline` to your `version` script after `npm run build`.

  `SurfaceContract` now also reads every command a CLI's help lists. It runs `<bin> <command> --help` for each one. A removed command is breaking. A command's own flags and exit code are judged like the top-level ones. A baseline taken before this release is compared on the top-level help until `update-baseline` records the commands. Every listed command must print its help and exit without side effects.

  `CodeScanning` now counts the directories a root `action.yml` runs code from as shipped, such as `scripts/github-action/`. Before, an alert there was excused as development-only, although users run that code through the action's tag.

  The run help lists `--scope <mode>` and `--base <ref>`.

  The managed `release.yml` and `sync-internal-package-contract.yml` callers now set `permissions: {}` at the top, so only each job's own grant applies. OpenSSF Scorecard's Token-Permissions finding flagged the missing top-level block. `ManagedFiles` reports the difference until `sync --apply --update` copies it.

  New check, `Prose`: no em-dash and no `--` dash substitute in the prose a package writes, meaning Markdown outside code, comments in TypeScript and JavaScript, and full-line YAML and shell comments. Code, strings and tool directives such as ESLint's `-- reason` are never read. It judges one punctuation habit, not whether the writing is clear.

  `generate` has two regions that read only the package's own files: `action-inputs` (the inputs of `action.yml`: name, whether required, default, first sentence of the description) and `supported-versions` (`engines.node` and each peer dependency, marked optional where `peerDependenciesMeta` says so). Neither needs `docs/surface.json`.

  `SurfaceContract` also baselines each reusable workflow under `.github/workflows/` (one with `on.workflow_call`): its inputs, secrets and outputs, judged like an Action's. A removed input, secret, output or workflow is breaking.

  This repository's own release now tags a version only after proving a workflow run on the same tree passed its `contract` job, as the consumers' shared release already did.

  `ApiContract` and `SurfaceContract` also fail when a branch rewrites a committed baseline while `package.json` keeps the base branch's version. Comparing against a baseline edited in the same pull request would hide that pull request's own change. The comparison point is the merge base with `origin/$GITHUB_BASE_REF` (or `origin/main`). A release (a new version), a first baseline, and the refresh of a baseline that was already stale on the base branch are allowed. Without the base branch in the clone, the comparison is skipped.

  `SurfaceContract` can baseline the Markdown headings a package's generators write. List the renderer source files under `internal-package-contract.surfaceRenderers` in `package.json`. Every heading in a plain string literal is recorded, and a removed heading is breaking. Headings built from data are left out.

  The shared release workflow now publishes a tree only when a run on it passed `contract` and, where the run has one, `required`. This repository's own release does the same before tagging, and runs again when CI finishes on `main`, so a tag that could not be proven on the first try is retried.

  The baseline guard treats a version change as a release only on a `changeset-release/*` branch. On a pull request that branch must live in the same repository, so a fork cannot borrow the name. On any other branch a changed version excuses nothing, so a feature branch that runs `npm run version` cannot refresh its own baselines past a breaking change. Dropping `surfaceRenderers` from `package.json` reads as every recorded heading removed, which is breaking.

  `EnvContract` now fails when a file `internal-package-contract env` generates is stale. It still only warns about credential dates and ownership, which depend on the calendar.

  `Prose` also reads a comment after a comma or before a closing bracket, and treats a code span that wraps across two `//` lines as code.

  This repository's release retries a tag on the commit CI ran on (`workflow_run.head_sha`), never on a later `main` commit.

  Check rationales, report text and the benchmark report's prose use a colon, semicolon, comma or parentheses where they used `--` or an em-dash. Only wording changed; a script that matched the old text exactly needs updating. The `GENERATED FILE -- do not edit by hand` banner is unchanged. `GeneratedRegions` now runs on this repository itself, and its README states the Node.js range from `engines.node` in a generated region.

  Wording only: the benchmark workflows' log messages, two reusable-workflow input descriptions and the scaffolded issue-template contact link no longer use `--` as a dash. The generated `BENCHMARKS.md` uses shorter sentences. No check compares a committed `BENCHMARKS.md` with a fresh render, so nothing fails. To pick up the new wording without measuring again, run the suite with `--render`.

  `BranchProtection` now also requires the `required` status check where the package's CI has that job. That is a workflow under `.github/workflows` with both a `contract` and a `required` job, like the scaffolded `contract.yml`. A consumer whose ruleset names only `contract` fails the check until `required` is added to the ruleset (`internal-package-contract init --github` writes both). When the rulesets cannot be read, the check degrades exactly as before.

  Documentation only: the README defines a degradation once, before the check tables. Each check row names the degradation ids that check can record, such as `Commits:no-base`. The `Prose` row lists what the scan does not read. For the `PIN_SYNC_TOKEN` permissions, the README links to `docs/ENVIRONMENT.md`.

  Behaviour change: `upgrade` now also regenerates what the new release writes. After it syncs the managed files it runs `generate`, then `skill` when the package has `docs/skill.json` or turns on `AgentSkill`, then `env` when it has `ci/env.schema.ts`. It still never runs `update-baseline`: the baselines follow the package's own releases. The daily pin-sync pull request commits these files with the pin, since it stages every change. The move to this release still runs the previous release's `upgrade`, so run `internal-package-contract generate`, `skill` and `env` once by hand after it.

  Wording only, for adopters:

  - The README opens with what a package gets from the standard, what adopting it costs, and what it is not.
  - The pitch in `package.json`, the README and `--help` is now one sentence: "Reusable CI checks, workflows and document generators shared by every MaverickCER package, added and kept current with one command." `--help` names `init` and `upgrade` as those commands, and the README shows a real excerpt of `npm run contract` output.
  - `--help` lists `ambient` under `tool`.
  - The console prints a check's id once on a result line whose rationale already starts with it ("[FAIL] GeneratedRegions: [generate] stale …", not "GeneratedRegions: GeneratedRegions: …"). The rationale in `report.json`, the logs and the Markdown summary is unchanged.
  - The README's `Mutation`, `Tests`, `SecurityDeps` and `SecuritySocket` rows name the exception registry each check reads. The opening's "zero surviving mutants" now says a hand-verified record in `.repo-contract/exceptions/mutation.json` can exempt one.
  - The `PIN_SYNC_TOKEN` description of the reusable `dependency-pin-sync.yml` links to `docs/ENVIRONMENT.md` instead of listing the token's permissions.
  - The generated agent skill's "Authority" paragraph states what to do instead of what to avoid. `AgentSkill` reports the old text as stale.
  - `docs/ENVIRONMENT.md` takes this package's new wording for `SOCKET_SECURITY_API_KEY` (it fails under CI without a recorded exception) and `PIN_SYNC_TOKEN` (where to set `expiresAt`).
  - The benchmark report no longer says its dollar figures compare packages, which `READING-BENCHMARKS.md` advises against. Re-render with `run-suite.mjs <suite> --render`.
  - The managed `RELEASING.md` copy describes what a re-run does after a publish, and drops an em-dash from the `npm deprecate` example. `sync --apply --update` copies it.
  - New packages get a scaffolded `AGENTS.md` with a numbered loop and a done criterion, and `VERSIONING.md`, `CONTRIBUTING.md` and `SECURITY.md` that match what `ApiContract`, `SurfaceContract` and `BranchProtection` check today.

### Patch Changes

- 307f1c6: `CodeScanning` leaves out OpenSSF Scorecard findings. Scorecard uploads its results as code-scanning alerts, but they rate the repository (maintenance, code review, branch protection, dependency advisories, workflow token scopes), not code. The check treated the ones with no file as alerts in shipped code. They have no exception path, so every consumer's `main` failed `contract` once Scorecard had run. Pull requests still passed, because Scorecard only analyses `main`. The Scorecard report and badge still show these findings.

## 0.18.0

### Minor Changes

- 19a861f: The benchmark overhead gate judges accurate figures. The end-to-end baseline and with-package operations are sampled interleaved (A B, B A, ...; at least ten pairs at the suite's typical size), so the package's overhead is the per-pair difference, recorded with its median, mean, standard deviation and 95% confidence interval (`paired` on the with-package tiers; `overheadCi95Ms`, `overheadCi95Percent` and `pairs` on the analysis rows). `samplePaired` and `computePairedStats` are exported from the kit.

  The gate (`scripts/benchmark/gates.mjs`) fails only when the overhead ratio grew past the allowance _and_ the change is outside the two runs' intervals; a growth inside them is a note. A reference measured on another CPU model is reported, not judged: for fast work the ratio also depends on how much of a bare baseline is process start-up. The reusable `benchmark-pr` workflow therefore measures `main` on the same runner in the same job (`run-suite.mjs --typical-only`, from main's suite file with this checkout's runner) and passes it as a sixth `--example` field, which `render-summary` judges as the same-machine reference.

### Patch Changes

- 19a861f: The documents say what the checks do, and no more. The README now opens with a table of where each gate runs and what it cannot see, and every promise in README, EXCEPTIONS, TOOLKIT, SECURITY and CONTRIBUTING names its check, test or workflow. Claims that had no gate are narrowed or stated as limits: the `required` job blocks a merge only once a repository's ruleset names it (`init --github` writes it; the current consumers have not added it yet); a fix in a reusable workflow reaches a consumer when it re-pins the SHA, never on its own; the release `build` job runs the package's `verify` script, so only the `publish` job runs no repository code; the 0.17.0 release path has not yet produced a real release; the paired benchmark overhead gate ships in the next release and reaches a consumer when it re-pins; the `Commits` check rejects a `Co-Authored-By` trailer. The consumer templates get the same treatment: `contract.yml`, `release.yml` and the pin-sync workflow comments describe the ruleset and the `PIN_SYNC_TOKEN` as they are, SUPPORT directs readers to Issues (the scaffold does not enable Discussions), RELEASING names the contract-run requirement in the build job, and the benchmark guides drop vague wording.

## 0.17.0

### Minor Changes

- 5f5750e: Gates that could pass without looking now say so, and the documentation matches what the checks do.

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

## 0.16.0

### Minor Changes

- dc9720c: Bump `data-cap` to 0.9.0 and hand on its new `data-cap/observe` entry as `internal-package-contract/data-cap/observe`.

## 0.15.1

### Patch Changes

- c5edb93: The shared release workflow's "Create the GitHub Release" step now names the repository (`GH_REPO`). That job has no checkout, so `gh release` failed with "not a git repository" and, behind `continue-on-error`, every consumer release since 0.13.3 shipped without a GitHub Release. A test now requires `GH_REPO` or `--repo` on every `gh release` call in a job without a checkout.

  The Scorecard workflow template now uploads its SARIF to code scanning, so the per-check details behind the public score are readable by a reviewer (the public API keeps only each check's score and one-line reason). Consumers pick it up with the next `sync`.

  `TOOLKIT.md` gains "Evidence a reviewer can check": each package's single source of truth, the standard documents generated from it, how each format is validated, and how to attest a generated document in CI so a reviewer can verify it with `gh attestation verify`.

  `generate` has two new regions, both read from `docs/surface.json` like `entry-points`. `dependencies` states what installing the package adds, straight from `package.json` (dependencies, optional dependencies and required peers count as installed, as npm 7 and later install them; optional peers are left to the consumer), with a one-line reason per dependency (a missing or multi-line reason, or a reason for a package no longer declared, fails generation). `standards` lists the standard-format documents a package generates, each with the test that checks its format (generation fails when that test file is gone). `specs/generated-artifacts.md` joins the documents `generate` reads, and the new-package template carries a `dependencies` region in `ADOPTION.md`.

  `IPC_MUTATION_REPORT` no longer refuses the report of a real run. Stryker writes no entry for a file it places no mutant in (a module of re-exports, a module of types), so the report of a full run, or the merged slices of a sharded one, lacked those files and 0.15.0 refused it as made from another plan. A file the plan has and the report lacks is now accepted exactly when Stryker's instrumenter finds no mutant in the text on disk; a lacking file with mutants still refuses the report. `@stryker-mutator/instrumenter` is now a dependency.

  The `version` scripts of this package and of the new-package template run `npm install --package-lock-only` after `changeset version`, so a release no longer leaves `package-lock.json`'s own version behind `package.json`'s. That drift is what made the daily dependency-pin sync open a bump pull request that bumped nothing (#113).

  The official schemas packages validate their output against are now managed copies (`schema-sarif-2.1.0`, `schema-oscal-assessment-results-1.1.2`, `schema-cyclonedx-1.6` with the SPDX and JSF schemas it references, and `standards-readme`). Each is byte for byte as published at a release URL, with its SHA-256 pinned in `template/standards/README.md` and checked by this repository's tests. The CycloneDX files come from the specification's `1.6.2` tag rather than its moving `master` branch.

## 0.15.0

### Minor Changes

- 85528ba: Mutation testing can be split across parallel jobs. `IPC_MUTATION_SHARD=i/n` mutates slice `i` of `n` of the files the Stryker config selects, balanced by size and the same every time, and the `Mutation` check says which slice it judged and does not call an exception for another slice's mutant stale. `scripts/run-merge-mutation-reports.mjs` puts the slices' reports back into the report an unsharded run writes, and fails rather than writing a partial one. `IPC_MUTATION_REPORT=<file>` makes a run judge a report made elsewhere (the merged slices) by the same rule instead of mutating again, and adopts it only if it is evidence about this checkout: every mutant has a Stryker status, it covers exactly the files a full run mutates, and each file is the text on disk. A package whose full run outgrows a single six-hour job can now finish.

### Patch Changes

- 0ea105f: Bump `repo-contract` to 0.12.0.

## 0.14.0

### Minor Changes

- 7485b51: Add `--scope affected|full|auto` (and `--base <ref>`) to the contract run, built on `repo-contract` 0.12's affected-scope analysis. A bare run covers everything, as before. `--scope affected` runs only what the working tree's changes can affect: the `Tests` check names only the affected test files, `Mutation` mutates only the affected sources, `Crap` weighs only the functions of the affected files, and `Coverage` reports that the package-wide aggregate is not evaluated (a warning, never a pass) because a narrowed run cannot say it. `--scope auto` lets the environment decide: a pull request narrows, a push and a release do not, and `CI_FULL` forces everything. Wherever the analysis cannot be sure (a lockfile or tool config changed, a file it cannot place, a module that does not parse, git failing) it says so and everything runs. The scope is written to `reports/contract/scope.json` and printed at the start of the run.

  The pre-commit hook now runs `--scope affected`, and the Contract workflow template and this repository's CI run `--scope auto`. A push to main and a release still run everything, cold.

## 0.13.3

### Patch Changes

- 7bda133: The shared release workflow creates a GitHub Release for each version it publishes, with the notes taken from that version's CHANGELOG section in the published tarball (GitHub's generated notes when the package ships no CHANGELOG). Until now it created only the tag, so the Releases page stopped at the last release made before the tag-only flow. A failure creating the Release is shown on its step but never skips the npm verification that follows.

## 0.13.2

### Patch Changes

- 9f2cd92: - Updates `markdownlint-cli2` to 0.24 (markdown-it 15.0.3, smol-toml 1.9.1), so packages that install this standard no longer pull the vulnerable `markdown-it` 15.0.0–15.0.2 and `smol-toml` 1.8.0 copies.
  - The `Licenses` check uses the repository's `.licensee.json` as the policy through repo-contract 0.11.3, and `Tests` relies on repo-contract's own check that a run executed at least one test.

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
