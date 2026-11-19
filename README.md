# internal-package-contract

**Reusable CI checks, workflows and document generators shared by every MaverickCER package, added and kept current with one command.**

Together they are **the standard**: 57 checks, the CI and release workflows that run them, and the generators
that keep a package's documents equal to their sources. `init` adds the standard to a package. `upgrade vX.Y.Z`
moves the package to a newer release and brings every file the standard owns up to date. After that, every
pull request is checked against it.

`repo-contract`, `@maverickcer/env-cap` and `data-cap` run the standard today. It is for a maintainer bringing
a new or existing package under it, and for the agents working in that package.

It is not on npm. A package installs it from GitHub as a devDependency pinned to a release tag.

## Try it

In a package whose git tree is clean:

```sh
npx github:MaverickCER/internal-package-contract init   # pin the standard and add what its checks need
npm run contract                                        # run every check
```

`npm run contract` prints one line per check. This excerpt comes from a package whose README has a stale
generated region; the failure names the command that fixes it:

<!-- Checked against a real run by test/readme-contract-output.test.ts. -->

```text
[FAIL] GeneratedRegions: [generate] stale: README.md. Run `npx internal-package-contract generate` and commit the result.
[PASS] EngineMatrix: a workflow tests the declared minimum, Node.js 24 (tested: 24).
[PASS] PromptBlocks: no document still asks its author a question.
[PASS] DocsMarkdown: markdownlint-cli2 reported 0 issues.

3 pass, 0 warn, 0 not evaluated (accepted), 0 not evaluated (no exception recorded), 1 fail, 0 skipped.
```

`init` adds what the package lacks and overwrites nothing without `--force`. It changes a repository setting
only with `--github`. It ends with `doctor`, which lists what is set up and the steps only a person can take.
[Adopt it](#adopt-it) has the details.

No gate runs these two commands as written. This package is private, so `QuickStart` would pass as not
applicable, and its self-contract leaves the check out. `test/init-scaffold-health.test.ts` runs `init --name`
with a real install instead. `test/init-orchestrator.test.ts` runs `init` in an existing package with the install
stubbed.

## What a package gets

Each promise names the gate that fails when the promise stops being true, and that gate's limit.

| Promise                                                                                                                               | Gate                                                                                                                                                                                 | Limit                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A pull request cannot merge while a check fails                                                                                       | The `contract` and `required` jobs, required by the ruleset `init --github` writes; `BranchProtection` checks that ruleset                                                           | The admin role can bypass a ruleset. A `contract.yml` older than this release may narrow a pull request with `--scope auto`                                      |
| A breaking change cannot ship under a smaller version bump                                                                            | `ApiContract` and `SurfaceContract` diff the TypeScript API, CLI help, exported JSON files, workflow inputs, and `engines` and peer ranges against the baselines of the last release | Behaviour behind an unchanged signature or help text is unseen. Ranges are compared only in a package with a surface baseline: a CLI, schema, action or workflow |
| npm receives only a tree that passed `contract`, published from CI with provenance                                                    | The shared `release-npm-changesets.yml` workflow                                                                                                                                     | Shape-tested; no test runs the workflow end to end                                                                                                               |
| Tests that catch regressions: the coverage limits in [Thresholds](#thresholds), zero surviving mutants without a hand-verified record | `Coverage` and `Mutation`                                                                                                                                                            | The thresholds are the same for every package. A record in `.repo-contract/exceptions/mutation.json` exempts one mutant a person verified by hand                |
| Generated documents equal their sources                                                                                               | `GeneratedRegions`, `EnvContract`, `LandingPage`, and `AgentSkill` once turned on                                                                                                    | They check that a document is current, not that its prose is true                                                                                                |
| Shared workflows and configs stay equal to the pinned release                                                                         | `ManagedFiles` and `PinConsistency`                                                                                                                                                  | "Equal" means the installed release, not the newest one                                                                                                          |

## What it costs

- **A pinned devDependency.** `github:MaverickCER/internal-package-contract#v<version>`, run on Node.js 24 or
  later. The scaffolded `sync-internal-package-contract.yml` runs `upgrade` daily and opens a pull request for each new release, with the regenerated documents in it.
- **An adoption period.** An existing package starts in adoption mode: every check reports, and only the
  checks you promote fail the run. When the adoption period in [Thresholds](#thresholds) ends, `AdoptionMode` fails
  until `promote --all` ends the mode.
- **Three manual steps.** npm's trusted publisher, the repository's settings and secrets, and the review apps.
  `doctor` lists each with the values to enter.
- **CI time.** The `contract.yml` that `init` writes runs every check on every pull request and push to `main`.
  That includes the slow analyses (`Coverage`, `Crap`, `Mutation`). Under CI, `Mutation` runs every mutant each
  time, never an earlier result. A public package also pays `QuickStart`: a pack and an install of the tarball on
  every run, beside `PackedConsumer`'s own. In full local runs on 2026-11-16, `QuickStart` took 20.8 s for env-cap
  and 29.5 s for data-cap, with the other checks running alongside.

## Why one installed standard

Copying configs into every repository lets each copy drift on its own. A shared config package, such as an
ESLint config, covers one tool and stops before CI and release. A template generator writes the files once and
then forgets them.

This standard is installed, pinned and checked on every run. A fix made here reaches each package as one
re-pin pull request. A file the standard owns that drifts in a package fails `ManagedFiles` until
`sync --apply --update` restores it or an exception record says why it differs.

## What it is not

- **Not a menu.** The thresholds live in [`checks/`](checks/) and apply to every package. A package can replace
  a check's policy (`checks/parts`), and nothing stops it, but the intended change is one made here for all.
- **Not for every package shape.** It expects TypeScript in `src/`, a build to `dist/` and Vitest tests. A
  package of another shape fails the checks that assume this one.
- **Not runtime code.** It is a development dependency. `PackedConsumer` fails an entry point that imports it
  at load time, because a clean install of the package does not have it.
- **Not a judge of meaning.** Checks compare structure, freshness and tool output. Whether prose is true or a
  design is sound stays a review decision. Nothing it produces claims compliance with any standard.

## Part of the MaverickCER toolkit

`@maverickcer/env-cap` governs configuration and `data-cap` governs application data: siblings that apply the same capability-ownership model. `repo-contract` and `internal-package-contract` are how they are verified. See [the toolkit overview and glossary](https://github.com/MaverickCER/internal-package-contract/blob/main/TOOLKIT.md).

## Where each gate runs

A check only matters where something fails when it is false. This table is the map; every section below
names its row.

| Gate                             | Runs                                                                    | What it decides                                                                                                                                                                             | Limit                                                                                                                                                                                                                                     |
| -------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Git hooks in a consumer          | `pre-commit`, `commit-msg`, `pre-push`, after `init` or `install-hooks` | Nothing: a local convenience. `pre-commit` runs `--scope affected`; `pre-push` skips Coverage, Crap and Mutation                                                                            | Opt-in. `GitHooks` only warns when they are missing. `--no-verify` is not detectable; CI is the gate                                                                                                                                      |
| The consumer's `contract` job    | `.github/workflows/contract.yml`, calling the reusable `contract.yml`   | The merge. Each consumer's ruleset requires `contract` (strict: branch up to date) and review-thread resolution; `BranchProtection` checks it                                               | A `contract.yml` that this release's `init` wrote runs in full, with mutation in shards. An older file keeps its own arguments. Admin role can bypass the ruleset by pull request                                                         |
| The consumer's `required` job    | Same workflow; waits for `standard`, `node-floor` and `typescript-7`    | Fails unless every job it needs finished `success`                                                                                                                                          | `init` writes `required` into the ruleset it creates; an older repository adds it by hand. The three current consumers' rulesets require it. `BranchProtection` fails when the workflow has a `required` job the ruleset does not require |
| The release `build` job          | `release-npm-changesets.yml`, on a push to `main`                       | Refuses to pack a tree whose run did not pass `contract` and, where the run has it, `required`. Runs `npm run verify`, `PromptBlocks` under `IPC_RELEASE=1`, and imports the packed tarball | Shape-tested only (`test/release-workflow.test.ts`); no test runs the workflow end to end                                                                                                                                                 |
| The release `publish` job        | Same workflow, default branch only                                      | Publishes the exact tarball with OIDC provenance, then fails if npm does not serve the version with its attestation                                                                         | A GitHub Release that fails to create cannot fail the run (`continue-on-error`)                                                                                                                                                           |
| This repository's own `contract` | `.github/workflows/ci.yml`, required by the `main` ruleset              | Whether the standard passes its own standard: 30 checks from `repo-contract.config.ts`, Mutation at zero survivors                                                                          | 27 standard checks are not run here; the config lists each one with its reason. `typescript-7` is advisory                                                                                                                                |

Each row names the test, check or workflow that fails when it is false. The rulesets the rows mention are GitHub
settings, not files in this repository. `BranchProtection` checks a consumer's `contract` and `required` rules; any other ruleset
fact is verified with `gh api repos/<owner>/<repo>/rulesets`.

## Adopt it

One command, in an existing package or in an empty directory:

```sh
# an existing package: bring it under the standard
npx github:MaverickCER/internal-package-contract init

# a new package, in an empty directory
npx github:MaverickCER/internal-package-contract init --name @scope/pkg --owner MyOrg
```

`init` ends with `doctor`, a read-only report of what is set up, what to run next, and the steps only a person
can take. Running `init` again is safe: a second run leaves the scaffold byte for byte unchanged
(`test/init-scaffold-health.test.ts`). `init` refuses to start over uncommitted changes and never overwrites a
file the package has, so `git restore .` undoes it. `--force` is the one way to overwrite.

**In an existing package**, `init` adds:

- the pin and the `contract` script;
- the scripts and overrides the checks need;
- the hygiene files;
- the contract, release, Scorecard and pin-sync workflows;
- the git hooks and the Changesets config.

It writes every config, document and template the package lacks. It drafts `docs/surface.json`, starts
adoption mode and generates the API map.

**In an empty directory**, `--name` scaffolds a complete package from
[`template/package/`](template/package). `init` then installs, scaffolds again with the pin the lockfile names,
and runs `doctor`.

Flags: `--dry-run` prints the plan and changes nothing. `--strict` skips adoption mode. `--github` applies a
branch ruleset through the `gh` CLI; without it no repository setting changes. `--docs` takes the standard's
version of a shared document the package already has. `--tag vX.Y.Z` or `--spec <dependency spec>` chooses what
to pin. `--owner` and `--description` fill in the repository and description.

**Adoption mode.** A package that adopts starts with every check reporting, but only promoted checks deciding
the exit code. `init` writes `.repo-contract/adoption.json` (ninety days, nothing promoted). A failing check is
still a `FAIL`, shown as `FAIL (advisory)`, and the run exits 0. `promote <Check>` makes a check strict;
`promote --all` ends the mode. `AdoptionMode` warns with the days left and fails once the date has passed.
Since 0.17.0 `--strict` is not suspended during adoption: an unrecorded "not evaluated" result of a promoted
check fails under CI (`test/adoption-mode.test.ts`).

Three steps cannot be scripted: npm's trusted publisher, the repository's settings and secrets, and the review
apps. `doctor` lists them with the values to enter.

**Working on the standard itself.** Install a local checkout as a copy:
`npm install --install-links --save-dev file:../internal-package-contract`. A plain `file:` dependency is a
symlink, which makes the standard resolve its tools from the wrong `node_modules`. `doctor` says so when it
finds one. Otherwise pin a release tag, `github:MaverickCER/internal-package-contract#v<version>`, never `#main`.

### What installing it gives you

This package is never published to npm (`"private": true`; `test/release-versions-private-package.test.ts`).
A consumer installs it from this repository by tag or commit. For `npm run contract`, it gets `repo-contract`,
every executor and every tool config transitively. `bin/contract.mjs` prepends every `node_modules/.bin` it
finds, including this package's nested one.

That transitivity stops at the consumer's own scripts and at TypeScript's type resolution. A consumer that runs
`build` or `test` outside the contract, or extends the bundled `tsconfig` baseline, needs its own `typescript`,
`@types/node`, `vitest` and `@vitest/coverage-v8` devDependencies. Every current consumer has them.

This package needs the Node.js range in its own `engines.node`. `GeneratedRegions` keeps this table equal
to `package.json`:

<!-- ipc:begin supported-versions -->

| Requirement | Range  | Needed |
| ----------- | ------ | ------ |
| Node.js     | `>=24` | always |

<!-- ipc:end supported-versions -->

There is no programmatic import of this package: `contract.ts` ships as raw TypeScript, which Node refuses to
type-strip under `node_modules`. The CLI is the supported way to run it; `./eslint`, `./prettier`, `./tsconfig`
and `./config/*` are the tool configs.

**Git hooks** are installed by `init` or by `internal-package-contract install-hooks`, once per clone. The
scaffold has no install-time script (`test/init-scaffold-health.test.ts` checks the scaffold's `package.json`
for `preinstall`, `install`, `postinstall`, `prepare` and `prepublish`). `GitHooks` warns when they are missing
and never fails. CI runs the whole contract on every pull request, so a skipped hook changes nothing about what
a pull request must pass.

| Hook         | Runs                                                                                                                               |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `pre-commit` | `pre-push` with `IPC_HOOK_FULL=1`: the contract under `--scope affected`, every check the change can reach, slow analyses included |
| `commit-msg` | commitlint, with the bundled config                                                                                                |
| `pre-push`   | everything except the slow analyses (`Coverage`, `Crap`, `Mutation`)                                                               |

`test/hooks.test.ts` runs `pre-commit` and `pre-push` with stub `npm` and `node` commands and checks the arguments
each passes. For `commit-msg` it checks only that the file is executable.

## The checks

[`contract.ts`](contract.ts) declares the list in its `checks:` object; `test/contract.test.ts` pins the ids. The
writer phase runs the package's own `docs:api`, `docs:api:report`, `verify:readme-example` and `schema` scripts,
which may write files. `Build` writes `dist/`. `Tests` and `Mutation` write coverage and report artifacts. Under
`--scope affected`, `Crap` rewrites `reports/crap.json` to the affected functions. `SecurityDeps`, `SecuritySocket`,
`CodeScanning`, `DistNoUrls` and `CodeRabbit` add a blank record to their tracked registry under
`.repo-contract/exceptions/` for each new finding. The other checks are written to only read; no test proves that
for each one. Every tool uses the consumer's own config if present, otherwise a bundled default from
[`config/`](config/), so the contract enforces real rules on day one. `checks/parts` lets a package replace a
policy, and nothing stops it from doing so.

### Thresholds

The limits are the fleet's. Raise one in the file it names, for the whole fleet, never per consumer.
`internal-package-contract generate` writes this table from those constants. `GeneratedRegions` fails when it is
stale.

<!-- ipc:begin thresholds -->

| What is measured                                         | Limit             | Set by                                                                                   |
| -------------------------------------------------------- | ----------------- | ---------------------------------------------------------------------------------------- |
| Coverage of lines                                        | at least 80%      | `COVERAGE_THRESHOLDS` in `checks/strict.ts`, passed to repo-contract's `strict()`        |
| Coverage of statements                                   | at least 80%      | `COVERAGE_THRESHOLDS` in `checks/strict.ts`, passed to repo-contract's `strict()`        |
| Coverage of functions                                    | at least 80%      | `COVERAGE_THRESHOLDS` in `checks/strict.ts`, passed to repo-contract's `strict()`        |
| Coverage of branches                                     | at least 80%      | `COVERAGE_THRESHOLDS` in `checks/strict.ts`, passed to repo-contract's `strict()`        |
| CRAP score of one function                               | at most 30        | `CRAP_THRESHOLD` in `checks/strict.ts`, passed to repo-contract's `strict()`             |
| Cyclomatic complexity of one function                    | at most 20        | `MAX_COMPLEXITY` in `checks/strict.ts`, passed to repo-contract's `strict()`             |
| Duplicated share of the code                             | at most 0.75%     | `DUPLICATION_MAX_PERCENTAGE` in `checks/strict.ts`, passed to repo-contract's `strict()` |
| Mutation score: mutants detected, or covered by a record | 100%              | `MUTATION_MIN_SCORE` in `checks/strict.ts`, passed to repo-contract's `strict()`         |
| Benchmark overhead growth, work of 1 ms or more          | at most 50%       | `DEFAULT_GATES` in `scripts/benchmark/gates.mjs`. A package may override it.             |
| Benchmark overhead growth, work under 1 ms               | at most 70%       | `DEFAULT_GATES` in `scripts/benchmark/gates.mjs`. A package may override it.             |
| README length of a published package                     | at most 220 lines | `MAX_LINES` in `scripts/readme/validate.mjs`                                             |
| Adoption period                                          | 90 days           | `DEFAULT_DAYS` in `scripts/adoption/mode.mjs`                                            |

<!-- ipc:end thresholds -->

A check that cannot run here (no `gh`, no Chrome, no network) records a **degradation**, named by an id such as
`Commits:no-base`. It warns locally. Under `--strict`, the CI default, it fails unless
`.repo-contract/exceptions/environment.json` records `environment:<id>`.

The tables below list every check in three declaration-order phases (repo-contract ADR 0002). `generate` writes
them from `checks/standard.ts` and each check's doc header, and `GeneratedRegions` fails when they are stale. The
header, in the file the last column names, says what the check reads and exactly what fails it.

<!-- ipc:begin checks -->

### 1. Writers

Writers run first, in order.

| Check           | What it holds                                                                                                                           | Degradations | Exception registry | Defined in              |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ------------------ | ----------------------- |
| `ApiDocs`       | The package's `npm run docs:api` passes. It passes with a note when the script is absent.                                               | none         | none               | `repo-contract/presets` |
| `ApiDocsReport` | The package's `npm run docs:api:report` passes and leaves `docs/api-report` unchanged. It passes with a note when the script is absent. | none         | none               | `repo-contract/presets` |
| `ReadmeExample` | The package's `npm run verify:readme-example` passes. It passes with a note when the script is absent.                                  | none         | none               | `repo-contract/presets` |
| `Lint`          | ESLint reports no error. A warning warns.                                                                                               | none         | none               | `repo-contract/tiers`   |
| `Format`        | Prettier finds every file formatted.                                                                                                    | none         | none               | `repo-contract/tiers`   |
| `Schema`        | The package's `npm run schema` passes and leaves `schemas` unchanged. It passes with a note when the script is absent.                  | none         | none               | `repo-contract/presets` |

### 2. Build barrier

Writers finish first and readers wait, so the packaging checks see a fresh `dist/`.

| Check   | What it holds                                                             | Degradations | Exception registry | Defined in            |
| ------- | ------------------------------------------------------------------------- | ------------ | ------------------ | --------------------- |
| `Build` | The package's `npm run build` passes. It fails when the script is absent. | none         | none               | `repo-contract/tiers` |

### 3. Readers

Readers run concurrently, except where `isolated` or `dependsOn` says otherwise.

| Check                 | What it holds                                                                                                                                                       | Degradations                                          | Exception registry                                    | Defined in                                |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------- | ----------------------------------------- |
| `ApiContract`         | The public TypeScript API changed no more than the branch's changesets declare.                                                                                     | none                                                  | none                                                  | `checks/api-contract.ts`                  |
| `SurfaceContract`     | The CLI, schema, action and workflow surface changed no more than the changesets declare.                                                                           | none                                                  | none                                                  | `checks/surface-contract.ts`              |
| `Typecheck`           | `tsc --noEmit` reports no type error.                                                                                                                               | none                                                  | none                                                  | `repo-contract/tiers`                     |
| `CleanCheckout`       | The files git tracks type-check on their own, as CI and every consumer will see them.                                                                               | none                                                  | none                                                  | `checks/clean-checkout.ts`                |
| `Tests`               | The whole Vitest suite passes, with coverage recorded, and every skipped test has a committed reason.                                                               | none                                                  | `.repo-contract/exceptions/skipped-tests.json`        | `checks/tests.ts`                         |
| `Architecture`        | The module dependency graph obeys dependency-cruiser's rules.                                                                                                       | none                                                  | none                                                  | `checks/architecture.ts`                  |
| `GithubActions`       | Every workflow under `.github/workflows/` passes actionlint.                                                                                                        | none                                                  | none                                                  | `checks/github-actions.ts`                |
| `GitHygiene`          | The repository is publishable. Nothing tracked that must not be, nothing imported that is not tracked, and a `package.json` that scopes what ships.                 | none                                                  | none                                                  | `checks/git-hygiene.ts`                   |
| `GitHooks`            | Git in this clone uses the bundled hooks, so a commit and a push run the contract before CI does.                                                                   | none                                                  | none                                                  | `checks/git-hooks.ts`                     |
| `LandingPage`         | The committed landing page is what `docs/site.json` generates, and that content meets the bar.                                                                      | none                                                  | none                                                  | `checks/landing-page.ts`                  |
| `AdoptionMode`        | Whether the package is still adopting the standard, and whether that period is over.                                                                                | none                                                  | none                                                  | `checks/adoption-mode.ts`                 |
| `GeneratedRegions`    | Every generated region in the package's documents matches what its sources produce.                                                                                 | none                                                  | none                                                  | `checks/generated-regions.ts`             |
| `PromptBlocks`        | No document still carries a question the scaffold left for its author.                                                                                              | none                                                  | none                                                  | `checks/prompt-blocks.ts`                 |
| `EnvContract`         | The environment variables and secrets the package depends on are documented and current.                                                                            | none                                                  | none                                                  | `checks/env-contract.ts`                  |
| `ReadmeStructure`     | A published package's README answers the same questions, in the same order, as every other package's. A developer can then decide whether to adopt it.              | none                                                  | none                                                  | `checks/readme-structure.ts`              |
| `ScorecardWorkflow`   | A workflow publishes the package's OpenSSF Scorecard result, which the README badge reads live.                                                                     | none                                                  | none                                                  | `checks/scorecard-workflow.ts`            |
| `EngineMatrix`        | A workflow tests the minimum Node.js that `engines.node` promises.                                                                                                  | none                                                  | none                                                  | `checks/engine-matrix.ts`                 |
| `ManagedFiles`        | The files this package owns in a consumer still mean what the standard's copies mean.                                                                               | none                                                  | `.repo-contract/exceptions/managed-files.json`        | `checks/managed-files.ts`                 |
| `PinConsistency`      | The three pins of this package in a consumer name one revision.                                                                                                     | none                                                  | none                                                  | `checks/pin-consistency.ts`               |
| `BranchProtection`    | A merge into the default branch of `origin`'s repository needs a green `contract` job. Where the package's CI has a `required` job, the merge needs that green too. | `BranchProtection:gh-unavailable`                     | none                                                  | `checks/branch-protection.ts`             |
| `Coverage`            | The package-wide test coverage holds the standard's thresholds. Under `--scope affected` it warns without judging.                                                  | none                                                  | none                                                  | `repo-contract/tiers`, `checks/strict.ts` |
| `Crap`                | No function is both complex and poorly covered. Under `--scope affected` only the affected sources are judged.                                                      | none                                                  | none                                                  | `repo-contract/tiers`, `checks/strict.ts` |
| `Size`                | The package's `npm run size` passes. It passes with a note when the script is absent.                                                                               | none                                                  | none                                                  | `repo-contract/presets`                   |
| `NoMinify`            | Nothing the package ships is minified, and nothing asks for minification.                                                                                           | none                                                  | none                                                  | `checks/no-minify.ts`                     |
| `DistNoUrls`          | Every URL in the build output is explained by a committed record.                                                                                                   | none                                                  | `.repo-contract/exceptions/dist-urls.json`            | `checks/dist-no-urls.ts`                  |
| `Duplication`         | Copied code stays within a share of `src/`, as jscpd measures it.                                                                                                   | none                                                  | none                                                  | `repo-contract/tiers`                     |
| `Packaging`           | publint reports no packaging error. A warning warns. A private package passes as not applicable.                                                                    | none                                                  | none                                                  | `repo-contract/tiers`                     |
| `BundledDependencies` | Every package that package.json bundles is also declared in `dependencies`. A private package passes as not applicable.                                             | none                                                  | none                                                  | `repo-contract/tiers`                     |
| `TypeResolution`      | The published types resolve under every module resolution a consumer may use.                                                                                       | none                                                  | none                                                  | `checks/arethetypeswrong.ts`              |
| `PackedConsumer`      | The tarball npm would publish installs into an empty project, and every entry point imports.                                                                        | `PackedConsumer:install`                              | none                                                  | `checks/packed-consumer.ts`               |
| `QuickStart`          | The README's first commands work against the tarball npm would publish.                                                                                             | `QuickStart:network`                                  | none                                                  | `checks/quick-start.ts`                   |
| `Licenses`            | Every shipped dependency carries a license the policy allows.                                                                                                       | none                                                  | none                                                  | `repo-contract/tiers`                     |
| `DocsMarkdown`        | The root and `docs/` Markdown passes markdownlint.                                                                                                                  | none                                                  | none                                                  | `repo-contract/tiers`                     |
| `BenchmarkGuides`     | The package's `benchmarks/WRITING-BENCHMARKS.md` and `READING-BENCHMARKS.md` are identical to the canonical copies in this package's `template/benchmarks/`.        | none                                                  | none                                                  | `checks/benchmark-guides.ts`              |
| `BenchmarkComplexity` | No benchmark group grew to a worse growth class than it had at the last release without a person accepting it.                                                      | none                                                  | `.repo-contract/exceptions/benchmark-complexity.json` | `checks/benchmark-complexity.ts`          |
| `BenchmarkCoverage`   | Every public function with several inputs is benchmarked across all of them.                                                                                        | none                                                  | none                                                  | `checks/benchmark-coverage.ts`            |
| `DocsLinks`           | No local link in the docs is broken, and every external one was reachable or is accepted.                                                                           | `DocsLinks:<url>`                                     | none                                                  | `checks/docs-links.ts`                    |
| `DocsFragments`       | Every `#fragment` link in the hand-written Markdown names a heading that exists.                                                                                    | none                                                  | none                                                  | `checks/docs-fragments.ts`                |
| `Prose`               | No em-dash and no `--` dash substitute in the prose the package writes.                                                                                             | none                                                  | none                                                  | `checks/prose.ts`                         |
| `Accessibility`       | The package's committed docs site has no WCAG 2 AA error.                                                                                                           | `Accessibility:no-chrome`, `Accessibility:no-site`    | none                                                  | `checks/accessibility.ts`                 |
| `SecurityDeps`        | No known vulnerability ships in what users install, unless a committed record accepts it.                                                                           | none                                                  | `.repo-contract/exceptions/security-deps.json`        | `checks/security-deps.ts`                 |
| `SecurityDevDeps`     | The development and CI tooling carries no critical advisory, and every lower one is visible.                                                                        | none                                                  | none                                                  | `checks/security-dev-deps.ts`             |
| `SecuritySecrets`     | No secret is committed, as secretlint finds them.                                                                                                                   | none                                                  | none                                                  | `checks/security-secrets.ts`              |
| `SecuritySocket`      | Every alert on the package's own Socket.dev page is fixed or accepted by a committed record.                                                                        | `SecuritySocket:no-key`                               | `.repo-contract/exceptions/socket.json`               | `checks/security-socket.ts`               |
| `CodeScanning`        | Every open GitHub code-scanning alert on this ref is fixed, or sits in development-only code and is rejected by a committed record.                                 | `CodeScanning:not-enabled`, `CodeScanning:no-remote`  | `.repo-contract/exceptions/code-scanning.json`        | `checks/code-scanning.ts`                 |
| `Suppressions`        | Every comment that tells a tool to stop enforcing a rule says why, or has a committed record.                                                                       | none                                                  | `.repo-contract/exceptions/suppressions.json`         | `checks/suppressions.ts`                  |
| `DeadCode`            | No unused file, export or dependency, as knip sees them.                                                                                                            | none                                                  | none                                                  | `checks/dead-code.ts`                     |
| `Commits`             | Every commit since `origin/main` is a Conventional Commit.                                                                                                          | `Commits:no-base`, `Commits:pre-adoption`             | none                                                  | `checks/commits.ts`                       |
| `CodeRabbit`          | An AI review of the change. Its findings are advice, and its non-execution is recorded.                                                                             | `CodeRabbit:not-applicable`, `CodeRabbit:unavailable` | `.repo-contract/exceptions/coderabbit.json`           | `checks/coderabbitai.ts`                  |
| `Mutation`            | Every Stryker mutant is detected, or a hand-verified record covers it. None times out.                                                                              | none                                                  | `.repo-contract/exceptions/mutation.json`             | `repo-contract/tiers`                     |

<!-- ipc:end checks -->

`ReadmeExample` passes when its script is absent. It also passes when the script exists but its fixture is
missing (known follow-up).

**A brand-new package** (nothing but `package.json`) fails `Lint`, `Typecheck`, `Build`, `Architecture`,
`GitHygiene` and `Coverage` on its first run, each naming what is missing. This is deliberate. The `eslint` and
`tsconfig` baselines are meant to be extended by the consumer's own config, never substituted. So those checks
enforce real rules from day one. `Mutation` fails until there is something to mutate. `Accessibility` and
`BranchProtection` record a degradation instead. Run `git init`, add a `tsconfig.json` and `eslint.config.mjs` that
extend this package's, and a `src/` tree.

### Not cloned from `repo-contract.config.ts`

`security-network`, `adr-governance`, and the `test-unit/integration/property/e2e` split encode repo-contract's
own design rather than a package standard.

## Exceptions

A package with a good reason to break a rule records that reason in `.repo-contract/exceptions/`, never in a
comment or a flag. The owning check reads the committed record back every run.
[EXCEPTIONS.md](EXCEPTIONS.md) documents the record, every registry, and how a check that could not run is
handled. `npx repo-contract exceptions` lists what is in force, and every contract report carries the same
inventory.

## Contributor setup: Socket.dev

`SecuritySocket` warns when no API key is available. It fails on a rejected token, a network error, a rate
limit or a missing `socket` CLI (`checks/security-socket.ts`; `test/security-socket.test.ts`). In CI the
contract runs `--strict`, so the warning fails there unless `environment.json` records
`environment:SecuritySocket:no-key`. `init` writes that record with a 90-day expiry. A new package is therefore
green on day one and decides about a token before the record lapses.

- **On your machine:** `npm install --global @socketsecurity/cli`, then `socket login`; confirm with
  `socket config list` that `apiToken` is set.
- **In GitHub Actions:** create a Socket API token (socket.dev > Settings > API Tokens, permission
  `packages:list`). Add it as the secret `SOCKET_SECURITY_API_KEY`. Pass it to the reusable contract workflow
  under `secrets:` (the scaffolded `contract.yml` does).

`SOCKET_SECURITY_API_KEY` is read only by the `socket` CLI while the contract runs; shipped code never reads it.
Each scan spends Socket API quota, so it is spent sparingly (`scripts/contract-phases.mjs`,
`scripts/socket-score-cache.mjs`):

- **It runs last.** Every other check runs first; the scan happens only if all of them passed. A failing run
  prints `[SKIPPED] SecuritySocket` and costs nothing.
- **It is cached.** Socket scores a published version, so the result depends on `<package>@<version>` only. A
  successful score is kept for 24 hours; failures are never cached. `IPC_SOCKET_CACHE_DIR` moves the cache,
  `IPC_SOCKET_CACHE_TTL_HOURS` changes the lifetime, `IPC_SOCKET_CACHE=off` disables it. CI persists no cache: a
  cache written by a workflow that runs pull-request code can be poisoned, so the scaffolded workflows use none.

## Overriding a bundled config

Write your own and the check picks it up (`resolveConfig` in `checks/shared.ts`). Extend the bundled one so the
baseline still evolves centrally:

```js
// .dependency-cruiser.cjs
const base = require("internal-package-contract/config/dependency-cruiser")
module.exports = { ...base, forbidden: [...base.forbidden /* yours */] }
```

Available: `./config/dependency-cruiser`, `./config/knip`, `./config/stryker`, `./config/commitlint`,
`./config/secretlint`, `./config/markdownlint`, plus the `./eslint`, `./prettier`, `./tsconfig` baselines. The
`eslint` baseline carries one rule of its own, `ipc/no-network`. It requires that nothing under `src/` imports a
network module (`http`, `https`, `http2`, `net`, `tls`, `dns`, `dgram`, `undici`, `ws`). Nothing there may use a
network global either (`fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `navigator`). Type-only imports
are allowed; a package's `bin/` or bundled compiler is outside the rule (`test/eslint-no-network.test.ts`).

`npm` honors `overrides` only from the root project, so a fix made here does not reach a consumer. `GithubActions`
runs through `github-actionlint`, which unzips actionlint with `adm-zip@^0.5`; every `adm-zip` before 0.6.1 carries
published advisories. The `init` scaffold already adds this to the consumer's `package.json`:

```json
{ "overrides": { "adm-zip": "0.6.1" } }
```

## Customizing a check

Every check is two halves: the **evidence** and the **policy**. The evidence is the command, its working
directory, environment, timeout and output format. The policy is what that evidence has to show. Replace the half
you need:

```ts
import { standardChecks } from "internal-package-contract/checks/standard"
import { withEvidence, withPolicy } from "internal-package-contract/checks/parts"

const checks = standardChecks()
checks.Coverage = withPolicy(checks.Coverage, myPolicy) // standard evidence, your rule
checks.Lint = withEvidence(checks.Lint, { run: ["eslint", "--format", "json", "src"] }) // your evidence, standard rule
```

| Need                                     | Import                                                                                                                                              |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| The whole check (evidence and policy)    | `internal-package-contract/checks/<name>` (each check's own factory)                                                                                |
| The whole standard                       | `internal-package-contract/checks/standard`                                                                                                         |
| Split, swap or recombine halves          | `internal-package-contract/checks/parts` (`evidenceOf`, `policyOf`, `composeCheck`, `withEvidence`, `withPolicy`, `evidenceOfAll`, `policiesOfAll`) |
| An evidence script on its own            | `internal-package-contract/scripts/check-<name>.mjs` (prints one JSON envelope; never exits non-zero for a finding)                                 |
| The per-check log hooks for your own run | `internal-package-contract/logs` (`onEvidenceSaveToRepoContractLogs`, `onVerdictPrependRepoContractLogs`)                                           |
| A shared runtime module (managed copies) | `internal-package-contract/runtime/<name>`                                                                                                          |

The `check-*.mjs` evidence scripts are exported as source files: development tools, never part of what a package
ships. The libraries behind them are internal. Each exported runtime module has a benchmark suite under
[benchmarks/](benchmarks) (`npm run benchmark`). No CI job runs those suites, and nothing fails when a module
lacks one.

## Running a subset

```sh
npx internal-package-contract --checks Format,Lint,Typecheck,Tests
npx internal-package-contract --checks Mutation
npx internal-package-contract --skip Coverage,Crap,Mutation   # everything but the slow analyses
npx internal-package-contract --changed           # only the checks that what changed since the default branch can affect
npx internal-package-contract --json              # one machine-readable report on stdout
npx internal-package-contract --logs all          # keep each check's output in reports/contract/logs/<Check>.log (all, failing, off)
npx internal-package-contract --scope affected    # every check, but Tests, Mutation and Crap only for what the changes can affect
npx internal-package-contract --scope auto        # affected on a pull request, everything on a push or a release
```

`--strict` is the default when `CI` or `GITHUB_ACTIONS` is set (`scripts/contract-run.mjs`). It turns an
unrecorded "not evaluated" result into a failure; `--no-strict` turns it off. The log mode can also be set
with `IPC_LOGS` or `"internal-package-contract": { "logs": ... }` in `package.json`. A flag wins over the
environment, which wins over the package. A log file is written as soon as a check's evidence exists and its
verdict is prepended when known.

**Compared with the standard.** Each run's `report.json` and `summary.md` compare the contract with the standard
itself (`checks/baseline.ts`, through repo-contract's `explainTier`; `test/contract-run-loosened.test.ts`). The
section lists each standard check that is missing or turned off. It lists each numeric setting looser than the
standard's: the four coverage metrics, `Duplication`'s share, `Crap`'s threshold and complexity, and `Mutation`'s
score. Other options, such as a scan path or an ignore list, are not compared. Neither is a check replaced under
the same id; a note after the section names the seven IPC replaces itself.

**Narrowing a run.** `--changed` chooses checks; `--scope` narrows the work inside the checks that scale with the
code (`scripts/affected-scope.mjs`; `test/affected-scope.test.ts`). With `--scope affected`, `repo-contract`'s
affected analysis finds which test files and sources the changes can reach. Then `Tests` runs only those files,
`Mutation` mutates only those sources, and `Crap` weighs only their functions. `Coverage` is a package-wide
aggregate, so a narrowed run reports it as a warning. Anything the analysis cannot place makes the run full: a
lockfile, a tool config, a module that does not parse, a dynamic `import()`, git failing. `--scope auto` narrows
on a pull request and runs everything on a push to the default branch or a release; `CI_FULL=1` forces
everything. The scope is printed first and written to `reports/contract/scope.json`; `--base <ref>` chooses the
comparison (the upstream branch, then `origin/main`). Limit: the set to mutate is built from changed files. A
change outside `src/` that maps to a source is therefore mutated as that source (known follow-up).

The logs are written by two hooks that ship with `repo-contract` and are re-exported here:

```ts
import { runRepoContract } from "repo-contract"
import {
  onEvidenceSaveToRepoContractLogs,
  onVerdictPrependRepoContractLogs,
} from "internal-package-contract/logs"

await runRepoContract(config, {
  onEvidence: onEvidenceSaveToRepoContractLogs(), // the raw output, the moment a check's evidence exists
  onVerdict: onVerdictPrependRepoContractLogs(), // the verdict, at the top of the same file
})
```

Both take the same options (`cwd`, `directory`, `mode`, `onProblem`). Writes happen in the background in order;
`await repoContractLogs(options).flush()` before reading the logs or ending the process.

## CI in a consumer

`init` writes [`.github/workflows/contract.yml`](template/contract.yml), a thin caller. Its `standard` job
calls this repository's reusable [`contract.yml`](.github/workflows/contract.yml), pinned by commit SHA like
`release.yml`, and `upgrade` re-pins it. It grants `security-events: read` and passes the Socket key. The
reusable workflow shards mutation, runs the whole contract once and uploads `reports/contract`. A bare `contract`
job passes only when `standard` did, because GitHub names a called job `standard / contract`. Without a pinned
commit to call, `init` skips the file and says so (`test/contract-workflow.test.ts`, `test/init.test.ts`).
`init` leaves an existing `contract.yml` as it is, so one written before this release keeps its own arguments,
such as `--scope auto`. To move to the sharded caller, delete the file and run `init` again.

Three jobs feed a `required` job that fails unless each finished `success`: `standard`, `node-floor` and
`typescript-7`. `node-floor` builds and tests on Node 22, the declared `engines.node` floor. `typescript-7`
type-checks under TypeScript 7.

What the ruleset requires decides what blocks a merge. `init --github` writes a ruleset requiring `contract` and
`required`, both pinned to the GitHub Actions app (`scripts/github-repo.mjs`). A repository that predates that
must add `required` itself. Until it does, `node-floor` and `typescript-7` are advisory there. `BranchProtection`
checks for `contract`, and for `required` where the workflow defines that job, so such a repository fails it until
its ruleset names `required`. The
`ci-jobs-test` managed copy fails when a job is missing from `required.needs`. The template is not a
managed file: a consumer may edit it without `ManagedFiles` noticing.

## Release

`init` writes [`.github/workflows/release.yml`](template/release.yml), a thin caller of this repository's
[`release-npm-changesets.yml`](.github/workflows/release-npm-changesets.yml), pinned by full commit SHA with the
release tag in a comment. A fix in the reusable workflow reaches a consumer when the consumer re-pins that SHA;
`dependency-pin-sync.yml` opens that pull request. Nothing reaches a consumer without a change in its own
repository. The caller needs the `version` and `release` scripts and the consumer's npm trusted publisher
registered. `init` writes `.changeset/config.json` but not those scripts, and never registers the publisher.
Pass `roll-floating-major-tag: false` for an npm-only consumer with no composite GitHub Action.

The reusable workflow is three jobs (`test/release-workflow.test.ts` pins the shape):

1. `version` holds no npm identity. It generates a changeset for a commit that has none, from its Conventional
   Commit type; a `Changeset: <bump>` trailer overrides the type. Below 1.0.0 a generated bump never exceeds
   minor. It opens or updates the "chore: version packages" pull request and dispatches CI on it. A person
   merges it; a major crossing is a `::notice`, not a block.
2. `build` is read-only. It installs with `--ignore-scripts` and runs `npm run verify` when the package defines it.
   It requires a workflow run on a commit with exactly this tree to have finished a job named `contract` with
   success. It then runs `PromptBlocks` under `IPC_RELEASE=1`, packs the tarball and installs it into a clean
   project. It looks for `contract` and, when the run has one, `required`.
3. `publish` checks out and installs nothing. From the default branch only, it publishes the exact tarball with
   OIDC and provenance (no `NPM_TOKEN`). It then tags the release, moves the floating `v<major>` tag within its
   major and creates a GitHub Release (`continue-on-error`). It fails unless npm serves the version with its
   attestation.

The template's `version` script is `internal-package-contract sync --release`. It runs `changeset version`, updates
`package-lock.json`, runs the `build` script when there is one, and runs `update-baseline`. Then it regenerates the
example goldens, agent skill and landing page where the package has them. It rewrites the SBOMs when
`docs/sbom.cdx.json` exists or `Sbom` is turned on, with the `sbom` script or else `tool sbom`. It refuses to start
outside git, on uncommitted changes, or without `@changesets/cli`. Pending changesets and
`.changeset/.release-bump.json` are the exception, so it runs after the release workflow generates them. It stops at
the first failing step and names the files the run changed, so only those are undone. A test runs the version job's
sequence end to end: generate changesets for a `feat:` commit, then `sync --release` (`test/sync-release.test.ts`).
The "chore: version packages" pull request therefore carries the API and surface baselines at the new version.
`ApiContract` and `SurfaceContract` fail on any baseline that records another version than `package.json`
(`test/api-contract-check-exact.test.ts`, `test/surface-run.test.ts`). A release that skipped the refresh therefore
fails its own pull request instead of letting later changes pass unjudged. A version bump is never a declaration:
only a changeset at the required level satisfies a diff. Both the template's `version` script and this repository's
own refresh the baselines. [`api-baseline-sync.yml`](.github/workflows/api-baseline-sync.yml) remains for a package
whose `version` script cannot build.

## Moving to a new release

`internal-package-contract upgrade vX.Y.Z` runs these steps:

- installs the release;
- re-pins the workflows that call its reusable workflows;
- brings the managed files up to date (`sync --apply --update`);
- regenerates the generated regions (`generate`);
- regenerates the agent skill (`skill`), when the package has `docs/skill.json` or turns on `AgentSkill`;
- regenerates `docs/ENVIRONMENT.md` (`env`), when the package has `ci/env.schema.ts`;
- regenerates the landing page, when the package has `docs/site.json`;
- copies the benchmark guides, when the package has `benchmarks/`.

It never runs `update-baseline`: the API and surface baselines follow the package's own releases.

It stops at the first failing step and leaves everything as uncommitted changes (`test/upgrade.test.ts`). The
reusable `dependency-pin-sync.yml` uses it when the installed release has it, and commits every file it changed
in the pin pull request. The steps come from the release installed before the move. So when a new release adds
a step, the move to it skips that step; run it by hand once.

Each consumer's `sync-internal-package-contract.yml` runs daily with its own token, opens nothing when the pin is
current, and re-pins workflows in the same pull request. GitHub does not let `GITHUB_TOKEN` push a change to
`.github/workflows/*`. A pin that moves a workflow SHA therefore needs `PIN_SYNC_TOKEN`, a fine-grained token.
Its permissions and refresh steps are in [`docs/ENVIRONMENT.md`](docs/ENVIRONMENT.md#ci-secrets-pin_sync_token),
generated from `ci/env.schema.ts`. Without the token the run falls back to `GITHUB_TOKEN`, which cannot push the
workflow change. CI on the pull request is started with `GITHUB_TOKEN`, which GitHub lets dispatch a workflow, so the
token needs no Actions access. The token merges the pull request once CI is green, so the merge starts the release.

## Benchmarks

[`scripts/benchmark/kit/`](scripts/benchmark/kit) is the one way every package here benchmarks itself. A package
supplies a `suite.mjs` that imports its real functions and documents each one. The kit runs a ladder of doubling
sizes (ten by default) and measures wall time, CPU time and memory. It infers the big-O, prices the result, and
writes `results.json` (schema version 4, validated by `test/benchmark-results-contract-exact.test.ts`) and
`BENCHMARKS.md`.

- **Three views:** end-to-end total impact (empty functions, with and without the package), every function on
  its own, and what makes up one operation.
- **Import and run:** `import { defineSuite } from "internal-package-contract/benchmark"`; list functions as
  `{ call, input }`. `defineSuite` rejects undocumented entries.
- **Commands:** `run-suite.mjs <suite> [--quick] [--check] [--render] [--only ...] [--typical-only]`.
- **`init`** scaffolds `benchmarks/README.md`, `WRITING-BENCHMARKS.md`, `READING-BENCHMARKS.md`, a working
  `suite.mjs` and the `benchmark` scripts. `BenchmarkGuides` fails a package whose copies differ from
  [`template/benchmarks/`](template/benchmarks); `sync-benchmark-guides` rewrites them.

### What may fail a pull request

Numbers from different runners are not comparable, so a raw time delta is shown and never judged
([`scripts/benchmark/gates.mjs`](scripts/benchmark/gates.mjs); `test/benchmark-gates-exact.test.ts`):

1. a function whose **measured growth class differs** from its documented big-O (fitted on the largest sizes,
   with an R² floor);
2. the package's **overhead relative to its own bare baseline** growing past an allowance. The default
   allowances, one for millisecond-scale and one for microsecond-scale work, are in [Thresholds](#thresholds). A
   package tunes them with a `GATES` export in `benchmarks/budgets.mjs`.

Gate 2 is paired since 0.18.0. The baseline and the package are sampled interleaved (A B, B A, ...), so the
overhead is a per-pair difference with a 95% interval. Growth inside the intervals of the two runs compared is a
note, not a failure (`scripts/benchmark/kit/measure.mjs`; `test/benchmark-measure-exact.test.ts`). The reference
judged is `main`, measured on the same runner in the same job at the typical size. Committed results of `main`
and the last release are judged only on the same CPU model, and reported otherwise. A suite `main` lacks has no
reference and is reported, not judged.

A function whose big-O **cannot be determined** is a warning that says why, in the pull-request comment and in
`BenchmarkComplexity`, never a failure. There is no threshold on a raw time anywhere. Whether a red benchmark
job blocks a merge is the consumer ruleset's decision; no consumer requires `benchmark-pr` today.

### Every input of every public function

`BenchmarkCoverage` fails until each public function with several inputs is benchmarked and each of its
parameters or keys is accounted for. It reads the committed API baselines (`.repo-contract/api-contract`). Each
parameter or key is listed in `covers` as `swept`, `sweep:<variable>`, `variant:<name>`, `fixed: <why>` or
`not covered: <why>`. A function with no benchmark is listed under the suite's `notBenchmarked` with its
reason. A name that is no longer public is stale and fails. See `benchmarks/WRITING-BENCHMARKS.md`.

### The workflows

- [`benchmark-pr.yml`](.github/workflows/benchmark-pr.yml) (reusable) runs on a pull request from the same
  repository, never a bot's. It builds, runs `npm run benchmark:check` and the benchmarks, and measures `main`'s
  end-to-end pair on the same runner. It renders the summary with the gates and posts or updates the comment.
  It then fails the job if a gate failed (`test/benchmark-workflow.test.ts`). Its token can comment and nothing
  else. The caller lists suites (one `label|directory|history-file` per line), names `budgets-path`, and pins
  the workflow by commit SHA.
- [`benchmark-record.yml`](.github/workflows/benchmark-record.yml) (reusable): after a merge, it measures the
  merge commit and opens a results pull request naming the merge commit, pull request and package version. No
  test covers this workflow.

### History, summaries and the page

[`scripts/benchmark/`](scripts/benchmark) turns results into history, a summary and a page:

- **`append-history.mjs <results.json> <history.json> [--commit <sha>] [--pr <n>]`** appends a compact entry.
- **`classify-complexity.mjs`** infers the growth class of a group from its tiers.
- **`complexity-gain.mjs`** finds every group whose class got worse than at the last release and matches it
  against the exception registry. `BenchmarkComplexity` and the pull-request gate both use it.
- **`render-summary.mjs`** renders the pull-request comment: gate results first, then class shifts, then one row
  per function and variable with its big-O and whether that changed.
- **`render-page.mjs`** builds `docs/benchmarks/index.html` on each deploy (never committed): one chart per group,
  every figure also as a table, no script, WCAG 2.2 AA.

A consumer wires them as thin npm scripts:

```json
{
  "scripts": {
    "benchmark:history": "node node_modules/internal-package-contract/scripts/benchmark/append-history.mjs",
    "benchmark:summary": "node node_modules/internal-package-contract/scripts/benchmark/render-summary.mjs",
    "benchmark:page": "node node_modules/internal-package-contract/scripts/benchmark/render-page.mjs"
  }
}
```

A package also defines `docs:benchmarks` (`render-page.mjs` with `--out docs/benchmarks/index.html`, `--readme`
and one `--history "<label>|<file>"` per history file). The contract runs it before the checks whenever the
package defines it. A link check therefore behaves the same on a clean checkout, a laptop and in CI.

## Landing page

A package's landing page is content in `docs/site.json`, rendered by `npx internal-package-contract site` into
`docs/index.html`, `brief.html`, `styles.css` and `script.js`. The validator names every missing or weak field
(hero outcome, problem, model, demo, each promise with its scope, comparison, adoption, `notFor`, manager brief,
resources). `site --check` reports stale output without writing. `LandingPage` fails when the content is invalid
or the committed pages differ from what it produces; `Accessibility` scans the result. What the validator enforces
is mechanical; whether the copy is true stays a human review.

## Generated regions, prompts and decision records

A document marks a derivable fact as a generated region, and `internal-package-contract generate` writes it:

```md
<!-- ipc:begin entry-points -->
<!-- ipc:end entry-points -->
```

`entry-points` is the public API map: one row per entry point `package.json` exports, with the source folder,
runtime constraint, stability tier and purpose from `docs/surface.json`:

```json
{
  "entries": {
    ".": {
      "source": "src/",
      "environment": "isomorphic, zero deps",
      "tier": "Stable",
      "purpose": "What a reader gets from this entry point."
    }
  }
}
```

Two more regions read the same file. `dependencies` states what installing the package adds, read from
`package.json` itself. The reason for each comes from `"dependencies"` in `docs/surface.json`. A dependency
without a reason, or a reason for a package no longer declared, fails generation. `standards` lists the
standard-format documents the package generates, one row per entry in `"standards"`. Generation fails when the
cited test file does not exist (`test/generate-standards.test.ts`). It checks that the file exists, not that it
validates the format.

Two regions read only the package's own files and need no `docs/surface.json`. `action-inputs` lists the inputs
of the root `action.yml`: name, whether required, default, and the first sentence of the description.
`supported-versions` lists `engines.node` and each peer dependency, marked optional where
`peerDependenciesMeta` says so (`test/generate-new-regions.test.ts`).

Two regions state the standard itself, read from the installed copy of this package. `thresholds` lists each limit
with the constant that sets it. `checks` lists every check by phase, with the summary, degradation ids and
exception registry its doc header names. Generation fails on a constant or header it cannot read
(`test/generate-standard-regions.test.ts`). This README carries both.

```json
{
  "dependencies": { "@typescript/typescript6": "The compiler the build entry parses with." },
  "standards": [
    {
      "document": "Findings",
      "standard": "OASIS SARIF 2.1.0",
      "producedBy": "`buildSarifLog`",
      "checkedAgainst": "The official OASIS schema",
      "test": "test/build/sarif.test.ts",
      "limits": "Not wired to the CLI."
    }
  ]
}
```

`generate` rewrites only what is between the markers and changes nothing on a second run. `generate --check`
writes nothing. `GeneratedRegions` runs it and fails on:

- a stale region;
- markers that are missing, repeated or out of order;
- a source that disagrees with `exports`.

Only the documents listed in `scripts/generate/documents.mjs` are read. `add export <name>` adds a new entry
point to `docs/surface.json` as `Experimental` with a `TODO:` purpose.

A scaffold asks for what only its author knows with `<!-- ipc:prompt: ... -->` (or a `TODO:` value in
`docs/surface.json`). `PromptBlocks` warns while any is left and fails under `IPC_RELEASE=1`, which the release
`build` job sets. It checks that a question is gone, never that the answer is good.

`internal-package-contract new adr "<title>"` starts a decision record in `specs/decisions` (or `docs/decisions`,
`docs/adr`) with the next number and the sections every record has.

## Optional checks

A check that not every package needs is off until the package names it. There are three: `AmbientCapabilities`,
`Sbom` and `AgentSkill` ([Agent skills](#agent-skills)). `internal-package-contract add check <Name>` writes the name
under `"internal-package-contract"."checks"` in `package.json`, with its settings beside it. `init` never turns one
on. `QuickStart` was the fourth. It is now a standard check, from repo-contract's tier. A `"checks"` entry naming
it is ignored, and each contract run prints one line on stderr saying so (`test/quick-start.test.ts`).

`AmbientCapabilities` reads the tarball npm would publish. It fails if a shipped file reaches `node:fs`,
`node:child_process` or `process.env` outside the entry points listed for that capability. It also fails if a
shipped file declares a forbidden dependency. Each capability lists its allowed entry points (`"bin"`, or an
export such as `"./node"`); a capability that is not listed is not checked. Bundled code under `node_modules/`
is not read: npm packs it only for bundled packages and their own dependencies.

```json
"internal-package-contract": {
  "checks": ["AmbientCapabilities"],
  "ambientCapabilities": {
    "child_process": [],
    "env": [],
    "fs": ["bin", "./eslint-plugin"],
    "forbiddenDependencies": ["cross-spawn"]
  }
}
```

It is a textual defense, not a proof: it catches a literal reintroduction, and splitting the string evades it.
`internal-package-contract tool ambient` gives the same answer without running the contract. A package with its
own contract file imports `ambientCapabilitiesCheck` from `internal-package-contract/checks/ambient-capabilities`.

`QuickStart` runs the README's first commands against the tarball npm would publish. A `private: true` package
passes it as not applicable, though the commands still run. Mark them by putting
`<!-- quick-start:begin -->` on the line before a fenced `sh` block and `<!-- quick-start:end -->` on the line
after it. The block holds one command per line, and one of them installs the package.
`repo-contract quick-start` packs the package and makes an empty project: a directory holding only a
`package.json`. The command that installs the package installs the tarball instead. Each line then runs in a
shell, in order, within five minutes in total. The check fails on a command that exits non-zero, with its last
output. It also fails on a README with no marked block, and on a block that never installs the package.

`add check QuickStart` writes nothing and says why. The check reads no settings. Its commands reach the registry. A
command that fails with a network error code (`ENOTFOUND`, `EAI_AGAIN`, `ECONNREFUSED`, `ECONNRESET`, `ETIMEDOUT`)
is the `QuickStart:network` degradation. Any other failed install is a finding.

`Sbom` keeps two CycloneDX 1.6 documents in step with `package-lock.json`: `docs/sbom.cdx.json` lists every
locked package, and `docs/sbom.production.cdx.json` lists what installing the package brings in. Both are built
from the lockfile alone, by repo-contract's `sbom` preset, with purls, the lockfile's hashes, declared licenses and
the dependency graph. The same lockfile always gives the same document. The check fails when a document is
missing or differs from what the lockfile gives; it ignores the serial number, the timestamp and formatting.
`internal-package-contract tool sbom` writes both documents; run it after the lockfile changes and commit them.
`add check Sbom` writes only the name. The documents describe what the lockfile pins, not what is installed.

## Agent skills

`internal-package-contract skill` writes `skills/<name>/SKILL.md`, a manual short enough to load every time (600
words by default, 1000 at most), and `skills/<name>/references/api.md`, the signatures. `skill --check` writes
nothing and fails when the output is stale. Nearly all of it is read from `package.json`, `docs/surface.json` and
the committed API baselines; the rest lives in `docs/skill.json`:

```json
{
  "when": "Load when a task calls widget(). Skip it for anything else.",
  "purpose": "One sentence: what a reader gets from it.",
  "notFor": "What it is not for.",
  "example": { "file": "examples/basic.ts", "lines": [3, 20] },
  "rules": ["What an agent must do, or must never do, that its types do not say."],
  "behavior": ["What happens that would surprise a reader."],
  "mistakes": [{ "wrong": "what an agent writes", "right": "what to write instead" }],
  "verify": ["How to tell it worked."],
  "references": [{ "when": "When to read more", "path": "GUIDE.md" }]
}
```

The example is taken from a real file, no longer than `LONGEST_EXAMPLE` in `scripts/skill/inspect.mjs`. `when`
is at most 300 characters. `add check AgentSkill` turns on `AgentSkill`, which fails on a stale, invalid or
over-budget skill. It judges shape and size, never whether the advice is good; nothing measures whether a skill
makes an agent more accurate.

## Build and release helpers

The scripts every package used to copy run from here as `internal-package-contract tool <name>`:

- `size`: fails when an entry point is over its gzip budget, the default export of `ci/size-budgets.mjs`.
  `--json <file>` also writes the sizes.
- `badges`: writes the coverage and size badges from their summaries.
- `api-report`: fails when `docs/api-report/` is not what `typedoc.markdown.json` generates.
- `cjs-interop`: makes `require()` of the built ESLint plugin return the plugin.
- `compiler-isolation`: fails when a client entry can reach the bundled TypeScript compiler.
- `ambient`: the `AmbientCapabilities` answer, without the contract.
- `sbom`: writes `docs/sbom.cdx.json` and `docs/sbom.production.cdx.json` from `package-lock.json`, the
  documents the `Sbom` check reads.

## Shared files

Files that are the same in every package are managed copies: one place to change, a drift check for the rest.
The workflows (`release`, `scorecard`, `env-rotation`, `sync-internal-package-contract`) and
`.changeset/config.json` are always managed (`scripts/managed-files/inspect.mjs`; `test/managed-files.test.ts`).
Opt-in copies are enrolled with `sync --add <name>` and restored with `sync --apply --update`:

- `.editorconfig`, `typedoc.markdown.json` and `benchmarks/budgets.mjs`.
- The two benchmark guides.
- The shared runtime modules under `src/_ipc/`.
- The official schemas a package's tests validate against (`schema-sarif-2.1.0`,
  `schema-oscal-assessment-results-1.1.2`, `schema-cyclonedx-1.6` with its SPDX and JSF references). They are
  carried into `test/fixtures/standards/` with a README that records each release URL and SHA-256.
  `test/standard-schemas.test.ts` fails if a byte changes.

Two test-support copies carry a gate into each package's own suite. `ci-jobs-test` fails when a job of `ci.yml`
is not waited for by `required`. `vm-bundle` runs a browser bundle in a `vm` context with no Node globals.

### Documenting the environment

`internal-package-contract env` writes `docs/ENVIRONMENT.md` from `ci/env.schema.ts`, the credentials and
settings a package depends on, read with env-cap and never run. What the standard itself reads (`PIN_SYNC_TOKEN`,
`SOCKET_SECURITY_API_KEY`, every `IPC_*` variable and `CI`) is declared once in this package's own
`ci/env.schema.ts`. `test/env-schema-coverage.test.ts` fails when the code or the hooks read an `IPC_*` variable
the schema lacks, or the schema keeps one nothing reads. The
cross-package discovery of env-cap includes that file in every consumer's document. A package's own file holds
only what is particular to it. The scaffold adds `docs:env` and a weekly `env-rotation.yml`. That workflow opens
one issue when a credential with an `expiresAt` is due, and closes it when nothing is. Nothing in it is
required: every variable has a default and no manifest is generated. `EnvContract` fails when the generated
document is out of date and only warns on credential dates. `env --check` exits 1 on the same stale document,
for a script that wants to gate on it.

### env-cap and data-cap, carried by this package

Every entry point of `env-cap` and `data-cap` is handed on, so a consumer installs neither and lists neither.
`test/reexports.test.ts` checks that each is the very module the package ships:

| Instead of                   | Import                                                                                                                             |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `@maverickcer/env-cap`       | `internal-package-contract/env-cap`                                                                                                |
| `@maverickcer/env-cap/build` | `internal-package-contract/env-cap/build` (also `/node`, `/evidence`, `/helpers`)                                                  |
| `data-cap`                   | `internal-package-contract/data-cap`                                                                                               |
| `data-cap/build`             | `internal-package-contract/data-cap/build` (also `/runtime`, `/runtime/cache`, `/runtime/retry`, `/node`, `/evidence`, `/helpers`) |

This package is a development dependency, so these are for code that never ships. Production code depends on the
library itself.

## README layout

A published package's README helps a developer decide whether to adopt it, so every package answers the same
questions in the same order. `ReadmeStructure` (`scripts/readme/validate.mjs`; `test/readme-check.test.ts`)
enforces the layout:

- the ten sections, in this order:
  1. **Why it exists**
  2. **How it differs**
  3. **What it does** (with `### See it run`)
  4. **Install and verify**
  5. **Fit and capabilities**
  6. **Limits and when not to use it**
  7. **Security and supply chain**
  8. **Maturity, versioning and support**
  9. **Documentation**
  10. **Next steps** (Evaluate, Integrate, Verify)
- the seven badges (CI, npm, coverage, mutation, Scorecard, Socket, license);
- the README length limit in [Thresholds](#thresholds).

It checks presence, not the values. The coverage and mutation badges read JSON the package publishes to its
Pages site, with a details file beside each:

- `coverage.json`: the lowest of four measures;
- `mutation.json`: the share of applicable mutants detected;
- `size.json`.

`scripts/run-mutation-badge.mjs` writes `docs/mutation-badge.json` from the Stryker report. Whether the prose is
true stays a human review.

## What stands between a change and a release

A release is gated by evidence that already exists, not by a second system.

| Requirement                                                                    | Enforced by                                                                                           | Limit                                                              |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Quality gates pass; the branch cannot merge red                                | the consumer's `contract` and `required` jobs, both required by the three current consumers' rulesets | admin bypass by pull request                                       |
| API and surface changes carry the right bump                                   | `ApiContract`, `SurfaceContract`; a human merges the release pull request                             | behaviour behind an unchanged signature is unseen                  |
| Package metadata, license and contents are right                               | `Packaging`, `BundledDependencies`, `Licenses`, `GitHygiene`, `DistNoUrls`, `Size`                    |                                                                    |
| The published types resolve under every module mode                            | `TypeResolution` on the packed tarball                                                                |                                                                    |
| What npm would ship installs and imports for a consumer                        | `PackedConsumer`; the same script on the exact tarball in the release `build` job                     | peer-dependent entries are skipped in both places                  |
| The README's first commands work against what npm would ship                   | `QuickStart`; a private package passes it as not applicable                                           | runs only the marked block; a network error is a degradation       |
| The committed SBOMs match the lockfile                                         | `Sbom`, once turned on                                                                                | describes what the lockfile pins, not what is installed            |
| The declared minimum Node.js is tested                                         | `EngineMatrix`                                                                                        | reads the literal, not whether the job is required                 |
| Workflows and config this package owns have not drifted                        | `ManagedFiles`; `sync` shows the difference and restores only when told                               | "current" means the installed release                              |
| Third-party actions are pinned; pins agree                                     | `GithubActions`, `PinConsistency`                                                                     | offline; the SHA is not checked against this repository's branches |
| Publishing uses OIDC, no stored token, the pinned npm, the exact built tarball | `release-npm-changesets.yml` (`test/release-workflow.test.ts`)                                        | shape-tested; no test runs the workflow end to end                 |
| Publishing happens only from the default branch                                | the `publish` job's `if`                                                                              |                                                                    |
| The registry serves the version with its provenance attestation                | the last step of the `publish` job                                                                    |                                                                    |
| The package's security posture is visible and scored                           | `SecurityDeps`, `SecuritySocket`, `ScorecardWorkflow`, `CodeScanning`                                 | Socket scores the published version                                |
| The README answers whether to adopt it                                         | `ReadmeStructure`                                                                                     | structure only                                                     |

A single "release readiness" verdict would repeat the contract's own report. A managed-file list covering the
whole scaffold would report drift in files a package is meant to change. So `init` stays non-destructive, `sync`
is a separate act from checking, and the managed list is five files compared on what they mean.

## Describing a change once

`internal-package-contract report` reads the evidence a package already holds and writes the pull-request
account as Markdown (`test/change-report.test.ts`). The account covers:

- what changed, by area;
- each new changeset with its bump;
- the decision records added;
- the exceptions recorded or retired;
- the dependencies moved;
- what each check said in the last contract run.

It ends with what no local run can see: CodeRabbit's review, GitHub's settings, the benchmark job, and the CI
jobs the contract does not run. None of those is assumed to have passed. Nothing in the account is written by
hand. `report --base <ref>` measures against another ref (default `origin/main`); `--out <file>` writes it. Run
the contract first, or the report says that it has not been run.

## Changing the standard without breaking what depends on it

`internal-package-contract verify-consumers <checkout>...` names every consumer check that got worse under this
version of the standard (`test/verify-consumers.test.ts`). It runs each consumer's fast offline checks twice, in
throwaway copies: once with the standard the package has installed and once with this one. A check that fails
both ways is not blamed on the change; the checkout is never touched. The network and service checks, coverage,
CRAP and mutation are not run; `--skip a,b` leaves out more and `--keep` keeps the copies. It also says where an
install would add its own copy of a package the standard depends on.

`--compare` prints each check's verdict both ways (`test/verify-consumers-compare.test.ts`). It fails on any
verdict change, better or worse, that `ALLOWED_DIFFERENCES` in `scripts/verify-consumers/compare.mjs` does not
explain. A rationale that changed under the same verdict is listed as `reworded`. `--checks a,b` runs only those
checks; a `--skip` that leaves none of them is refused. Its second copy takes the standard's own copy of each
package the checkout does not declare, as an install would. No CI job runs either mode yet. It needs an installed
checkout of each consumer, and no workflow clones and installs them. Until one does, a consumer's own CI on its
pin-sync pull request is the first run that can catch the break.

## Mutation testing

The `Mutation` check is repo-contract's Mutation preset at a score of 100. Every mutant is detected, or a record
in `.repo-contract/exceptions/mutation.json` covers it, and no Timeout stands. `checks/strict.ts` passes IPC's
settings to the preset as options (`test/strict.test.ts`). repo-contract runs every mutant cold, whatever a
package's `incremental` setting says. Under `CI`, no earlier result is reused, so none from a loaded machine can
pass the gate.

Locally, a clean run is reused while nothing it depends on has changed. Its key covers every file git does not
ignore, the Node.js version, the Stryker config and what the run was restricted to. `IPC_MUTATION_MEMO=0` runs
regardless. While writing, `internal-package-contract mutation` mutation-tests only what a change touched; only the
full check can say a change is finished.

A mutant that times out is run again alone before the timeout counts; at most five are. One that times out again
fails the check, and no record covers it.

When the run does not fit in one job, split it. `IPC_MUTATION_SHARD=i/n` mutates slice `i` of `n`, cut by file
size, the same way every time. A record in `mutation.json` for a mutant in another slice is not called stale.
`npx repo-contract mutation plan --json` says how many slices the mutate set needs: one per 64 KiB, at most 256.
Merge with `npx repo-contract merge-mutation --total <n> --out reports/mutation/mutation.json 1=<report> ...`; it
writes nothing and fails when a slice is missing, repeated, unreadable, or overlaps another
(`test/mutation-merge.test.ts`). Then a run with `IPC_MUTATION_REPORT=<merged report>` judges that report instead
of mutating. repo-contract adopts a report only on three conditions. Every file the run would mutate is in it or
holds no mutant. No other file is in it. Each file's text matches disk. Merge to
`reports/mutation/mutation.json`: an adopted report is judged where it lies, not copied there.

The reusable workflow `.github/workflows/contract.yml` does all of this (`test/contract-workflow.test.ts`). It
plans the slices, runs each as its own job, merges them and runs the contract once. This repository's `ci.yml`
calls it by local path. A consumer calls it pinned by commit SHA and keeps a bare `contract` job, because GitHub
names a called job `<caller> / contract`. With slices on, the contract run cannot take `--scope`: a narrowed run
refuses the full merged report. data-cap shards with its own `ci.yml`.

## Stability: what a release promises

A release's version tells a consumer whether `npm run contract` can start failing:

- **patch**: a fix that makes a check more correct for a package that already satisfies the standard.
- **minor**: a new check or a stricter rule, a new export, flag or subcommand. Below 1.0.0 a stricter rule is a
  patch-level bump, as for any 0.x package.
- **major**: removing or renaming a check id, a subcommand, a flag or an export. Changing the shape of an
  exception record or of the report in `reports/contract/` is also major. Below 1.0.0 a removal is a minor.

What a gate holds to that: the check ids (`test/contract.test.ts`), and the CLI and workflow surface
(`SurfaceContract` on this repository, baseline in `.repo-contract/surface-contract/baseline.json`). The CLI surface
is the top-level `--help`, the `--help` of every command it lists, and their exit codes. The workflow surface is the
inputs, secrets and outputs of each reusable workflow consumers call. A removed command, flag, input, secret or
output is breaking. An added one is compatible, except a required input. A change to help prose alone is compatible
(`test/surface-classify.test.ts`). The `engines` and `peerDependencies` ranges in `package.json` are compared too:
one that accepts less, such as a raised floor or a dropped major, is breaking. Only a package that keeps a surface
baseline gets this comparison: one with a CLI, schema, action or reusable workflow. A baseline written before ranges
were recorded compares none. The next release's `update-baseline` records them. A behaviour change behind unchanged
help is not seen. A version change excuses a baseline edit only on a `changeset-release/*` branch. A branch other
than the release branch that changes `package.json`'s version is treated like any other branch, so its baseline
edits fail. On a pull request, a `changeset-release/*` branch counts only when it lives in this repository, so a
fork cannot borrow the name (`test/baseline-guard.test.ts`).

These are intended to follow the same levels, but nothing diffs them, so review decides:

- the `./checks/*`, `./runtime/*`, `./env-cap*`, `./data-cap*`, `./logs`, `./config/*`, `./eslint`, `./prettier`,
  `./tsconfig` and `./benchmark` exports;
- the `./package.json` export, except the `engines` and `peerDependencies` ranges above;
- the exception-record format ([EXCEPTIONS.md](EXCEPTIONS.md));
- the `./scripts/check-*.mjs` output envelopes;
- `evidence.json` / `report.json`;
- the keys of the `"internal-package-contract"` section a consumer's `package.json` carries (`logs`, `checks`,
  `apiTargets`, `ciJobs`, `copies`, `ambientCapabilities`, `surfaceRenderers`). The one exception: removing
  `surfaceRenderers` from a consumer reads as every heading removed, which `SurfaceContract` treats as breaking.

Everything else under `scripts/` is an implementation detail.

There is no documentation website, because this package is not published. Its documentation is its README,
[EXCEPTIONS.md](EXCEPTIONS.md), [TOOLKIT.md](TOOLKIT.md), [SECURITY.md](SECURITY.md),
[CONTRIBUTING.md](CONTRIBUTING.md) and the guides in `template/`.

## Bootstrap order

This package depends at runtime on the published `repo-contract`, at the range its `package.json` names: every
check is a `repo-contract` check. `repo-contract` declares this package as a development dependency
(`github:MaverickCER/internal-package-contract#<tag>`) and consumes its API-contract engine and benchmark kit.
Neither needs the other's unreleased code, because `repo-contract`'s self-contract runs against its own fresh
`dist/` while this package resolves the published one. The upgrade order for a breaking `repo-contract` change:

1. publish the new `repo-contract`;
2. bump this package's `repo-contract` dependency and release it (a new tag);
3. re-pin `repo-contract`'s own devDependency on this package to that tag.

The rationale is [`repo-contract` ADR 0018](https://github.com/MaverickCER/repo-contract/blob/main/specs/decisions/0018-ecosystem-bootstrap-cycle-and-package-names.md).

## Evolving the standard

This package is the middle layer of the model in
[repo-contract ADR 0010](https://github.com/MaverickCER/repo-contract/blob/main/specs/decisions/0010-review-driven-contracts-and-shared-internal-system-contracts.md):

| Layer                           | Owns                                       | Answers                                     |
| ------------------------------- | ------------------------------------------ | ------------------------------------------- |
| `repo-contract`                 | execution, evidence, policy mechanism      | How is a requirement turned into a verdict? |
| **`internal-package-contract`** | the standard for a publishable package     | What must every package keep satisfying?    |
| `env-cap`, `data-cap`, ...      | package-specific checks and implementation | What else does this one package require?    |

A review finding becomes a new check here only when it exposes a repeatable error class that affects packages
and can be detected mechanically. One-off fixes stay in the package that found them.
