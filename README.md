# internal-package-contract

Three published packages (`repo-contract`, `@maverickcer/env-cap`, `data-cap`) must keep passing the same
checks, and nobody wants to maintain three copies of the rules. This repository holds the rules once: the
checks, the tool configs, the git hooks, the CI and release workflows, and `init`, the command that puts a
package under them in a day. It is the "package" row of the layered model in
[repo-contract ADR 0010](https://github.com/MaverickCER/repo-contract/blob/main/specs/decisions/0010-review-driven-contracts-and-shared-internal-system-contracts.md):

| Layer                           | Owns                                       | Answers                                     |
| ------------------------------- | ------------------------------------------ | ------------------------------------------- |
| `repo-contract`                 | execution, evidence, policy mechanism      | How is a requirement turned into a verdict? |
| **`internal-package-contract`** | the standard for a publishable package     | What must every package keep satisfying?    |
| `env-cap`, `data-cap`, ...      | package-specific checks and implementation | What else does this one package require?    |

`@maverickcer/env-cap` governs configuration and `data-cap` governs application data: siblings that apply the same capability-ownership model. `repo-contract` and `internal-package-contract` are how they are verified. See [the toolkit overview and glossary](https://github.com/MaverickCER/internal-package-contract/blob/main/TOOLKIT.md).

## Where each gate runs

A check only matters where something fails when it is false. This table is the map; every section below
names its row.

| Gate                             | Runs                                                                    | What it decides                                                                                                                                 | Limit                                                                                                                                                                           |
| -------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Git hooks in a consumer          | `pre-commit`, `commit-msg`, `pre-push`, after `init` or `install-hooks` | Nothing: a local convenience. `pre-commit` runs `--scope affected`; `pre-push` skips Coverage, Crap and Mutation                                | Opt-in. `GitHooks` only warns when they are missing. `--no-verify` is not detectable; CI is the gate                                                                            |
| The consumer's `contract` job    | `.github/workflows/contract.yml`, `npm run contract -- --scope auto`    | The merge. Each consumer's ruleset requires `contract` (strict: branch up to date) and review-thread resolution; `BranchProtection` checks it   | A pull request runs the affected scope only; the full run is the push to `main` after the merge. Admin role can bypass the ruleset by pull request                              |
| The consumer's `required` job    | Same workflow; waits for `node-floor` and `typescript-7`                | Fails unless every job it needs finished `success`                                                                                              | `init` writes `required` into the ruleset it creates. A repository that predates it must add the context itself; the three current consumers have not yet                       |
| The release `build` job          | `release-npm-changesets.yml`, on a push to `main`                       | Refuses to pack a tree no `contract` job passed on; runs `npm run verify`, `PromptBlocks` under `IPC_RELEASE=1`, and imports the packed tarball | No real release has run through this path since it was added in 0.17.0; consumer `main` branches still pin 0.16.0 or older. Shape-tested only (`test/release-workflow.test.ts`) |
| The release `publish` job        | Same workflow, default branch only                                      | Publishes the exact tarball with OIDC provenance, then fails if npm does not serve the version with its attestation                             | A GitHub Release that fails to create cannot fail the run (`continue-on-error`)                                                                                                 |
| This repository's own `contract` | `.github/workflows/ci.yml`, required by the `main` ruleset              | Whether the standard passes its own standard: 28 checks from `repo-contract.config.ts`, Mutation at zero survivors                              | 26 standard checks are not run here; the config lists each one with its reason. `typescript-7` is advisory                                                                      |

Each row names the test, check or workflow that fails when it is false. Nothing outside this repository is needed to verify it.

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

**In an existing package** `init` adds the pin and the `contract` script, the scripts and overrides the checks
need, the hygiene files, the contract, release, Scorecard and pin-sync workflows, the git hooks and the
Changesets config. It writes every config, document and template the package lacks, drafts `docs/surface.json`,
starts adoption mode and generates the API map. **In an empty directory** `--name` scaffolds a complete package
from [`template/package/`](template/package), installs, scaffolds again with the pin the lockfile names, and
runs `doctor`.

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

Three steps cannot be scripted and `doctor` lists them with the values to enter: npm's trusted publisher, the
repository's settings and secrets, and the review apps.

**Working on the standard itself.** Install a local checkout as a copy:
`npm install --install-links --save-dev file:../internal-package-contract`. A plain `file:` dependency is a
symlink, which makes the standard resolve its tools from the wrong `node_modules`; `doctor` says so when it
finds one. Otherwise pin a release tag, `github:MaverickCER/internal-package-contract#v0.17.0`, never `#main`.

### What installing it gives you

This package is never published to npm (`"private": true`; `test/release-versions-private-package.test.ts`).
A consumer installs it from this repository by tag or commit and gets `repo-contract`, every executor and every
tool config transitively for `npm run contract`: `bin/contract.mjs` prepends every `node_modules/.bin` it finds,
including this package's nested one.

That transitivity stops at the consumer's own scripts and at TypeScript's type resolution. A consumer that runs
`build` or `test` outside the contract, or extends the bundled `tsconfig` baseline, needs its own `typescript`,
`@types/node`, `vitest` and `@vitest/coverage-v8` devDependencies. Every current consumer has them.

There is no programmatic import of this package: `contract.ts` ships as raw TypeScript, which Node refuses to
type-strip under `node_modules`. The CLI is the supported way to run it; `./eslint`, `./prettier`, `./tsconfig`
and `./config/*` are the tool configs.

**Git hooks** are installed by `init` or by `internal-package-contract install-hooks`, once per clone. The
scaffold has no install-time script (`test/init-scaffold-health.test.ts` checks the scaffold's `package.json`
for `preinstall`, `install`, `postinstall`, `prepare` and `prepublish`). `GitHooks` warns when they are missing
and never fails. CI runs the same contract under `--scope auto`, so a skipped hook changes nothing about what a pull
request must pass; the full run is the push to `main`.

| Hook         | Runs                                                                                            |
| ------------ | ----------------------------------------------------------------------------------------------- |
| `pre-commit` | the contract under `--scope affected`: every check the change can reach, slow analyses included |
| `commit-msg` | commitlint, with the bundled config                                                             |
| `pre-push`   | everything except the slow analyses (`Coverage`, `Crap`, `Mutation`)                            |

## The checks

[`contract.ts`](contract.ts) declares the list in its `checks:` object; `test/contract.test.ts` pins the ids and
checks that the tables below list exactly those ids. Every check is read-only against the consumer's tree except
`Build` and `Tests`, which write build, coverage and report artifacts. Every tool uses the consumer's own config
if present, otherwise a bundled default from [`config/`](config/), so the contract enforces real rules on day
one. Thresholds are the fleet's, in [`checks/`](checks/): `coverage.ts` (80% for each of four measures),
`crap.ts` (CRAP 30, complexity 20), `duplication.ts` (0.75%). Raise them there for the whole fleet, never per
consumer; `checks/parts` lets a package replace a policy, and nothing stops it from doing so.

Three declaration-order phases (repo-contract ADR 0002):

### 1 — Writers

| Check           | How                                      | Blocks on                                                         |
| --------------- | ---------------------------------------- | ----------------------------------------------------------------- |
| `ApiDocs`       | `npm run docs:api` \*                    | the API-docs build failing                                        |
| `ApiDocsReport` | `npm run docs:api:report` \* + hash diff | the script failing **or** regenerating `docs/api-report`          |
| `ReadmeExample` | `npm run verify:readme-example` \*       | example CLI output drifting from README prose (skipped if absent) |
| `Lint`          | `eslint . --format json`                 | any ESLint **error** (warnings warn)                              |
| `Format`        | `prettier --check .`                     | any unformatted file                                              |
| `Schema`        | `npm run schema` \* + hash diff          | the script failing **or** regenerating a committed file           |

### 2 — Build barrier

`Build` — `npm run build`, `isolated`. Writers finish first; readers wait, so the packaging checks see a fresh
`dist/`.

### 3 — Readers (concurrent)

| Check                 | How                                                                                                                                                                                          | Blocks on                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ApiContract`         | diffs every target's public API against its committed baseline (needs `dist/.dts/`)                                                                                                          | the branch's changesets declaring a smaller bump than the diff requires. Limit: the schema-version rule (`scripts/api-contract/schema-version-consistency.ts`) treats any drift of a member named `version` as breaking, with no opt-out                                                                                                                                                                                            |
| `SurfaceContract`     | the `--help` and exit code of each `bin`, the JSON Schemas `exports` serve and the inputs and outputs of `action.yml`, against `.repo-contract/surface-contract/baseline.json`               | a surface change the branch's changesets do not declare a large enough bump for, or (in CI) a surface with no committed baseline; passes when the package has none of these. Behaviour behind an unchanged `--help` is unseen                                                                                                                                                                                                       |
| `Typecheck`           | `tsc --noEmit -p tsconfig.json`                                                                                                                                                              | any type error                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `CleanCheckout`       | the package's own type check on only what git tracks, with this installation's dependencies                                                                                                  | a file hidden by `.gitignore` or never added. Type check only; tests are not re-run on the clean copy                                                                                                                                                                                                                                                                                                                               |
| `Tests`               | `vitest run` **with** V8 coverage, once                                                                                                                                                      | any failing or errored test                                                                                                                                                                                                                                                                                                                                                                                                         |
| `Architecture`        | `depcruise src` — bundled `config/dependency-cruiser.cjs`                                                                                                                                    | any error-severity violation (circular deps, etc.)                                                                                                                                                                                                                                                                                                                                                                                  |
| `GithubActions`       | `github-actionlint` (npm wrapper for actionlint)                                                                                                                                             | any workflow finding (no workflows → pass). The files under `template/` are never linted as workflows                                                                                                                                                                                                                                                                                                                               |
| `GitHygiene`          | tracked build output, conflict markers, `.gitignore` gaps, `package.json` `files`, and an import of a file git does not track                                                                | tracked build output, a conflict marker, an import of an untracked file, no `.gitignore` at all, or a non-private package with no `files` array; an incomplete `.gitignore` and missing `.gitattributes`, `.editorconfig`, `.nvmrc`, license, `engines.node` or `type` only warn                                                                                                                                                    |
| `GitHooks`            | `core.hooksPath` against the bundled hooks (local only)                                                                                                                                      | never fails: warns when the hooks are not installed, with the command that installs them; passes in CI                                                                                                                                                                                                                                                                                                                              |
| `LandingPage`         | `docs/site.json` against the landing-page bar, and the generated `docs/index.html`, `brief.html`, `styles.css`, `script.js` against what it produces                                         | invalid content, or generated files that differ from it; passes when the package has no `docs/site.json`                                                                                                                                                                                                                                                                                                                            |
| `AdoptionMode`        | whether `.repo-contract/adoption.json` says the package is adopting the standard                                                                                                             | a warning while adopting (with the end date and what is enforced); a failure once the period has ended or the file is invalid; passes when the package is not adopting                                                                                                                                                                                                                                                              |
| `GeneratedRegions`    | the regions a document marks as generated (`<!-- ipc:begin entry-points -->`), against what `package.json` and `docs/surface.json` produce                                                   | a stale region, malformed markers, or a `docs/surface.json` that omits an exported entry point or lists one that is not exported (`internal-package-contract generate` rewrites them); passes when no document has a region                                                                                                                                                                                                         |
| `PromptBlocks`        | questions a scaffold left for its author (`<!-- ipc:prompt: ... -->`) in the documents and decision records                                                                                  | a warning while any is unanswered; a failure when a release is being verified (`IPC_RELEASE=1`, set by the release `build` job)                                                                                                                                                                                                                                                                                                     |
| `EnvContract`         | `ci/env.schema.ts`, the credentials and settings the package depends on, read (never run) with env-cap, and `docs/ENVIRONMENT.md` generated from it                                          | a warning for a credential that is expiring or has expired, or a generated file that is out of date; never fails. A package with no contract passes                                                                                                                                                                                                                                                                                 |
| `ReadmeStructure`     | `README.md` against the shared adoption layout in `scripts/readme/validate.mjs`: the ten sections in order, the seven trust badges, Evaluate/Integrate/Verify next steps, within 220 lines   | a missing, extra or misordered section, a missing badge, or a README past the limit; a private package is exempt                                                                                                                                                                                                                                                                                                                    |
| `ScorecardWorkflow`   | `.github/workflows` for a workflow that runs `ossf/scorecard-action` pinned to a commit, with `publish_results: true`, `id-token: write` and a schedule                                      | no such workflow, or one that cannot publish its result; a private package is exempt                                                                                                                                                                                                                                                                                                                                                |
| `EngineMatrix`        | `engines.node` against the `node-version` literals in `.github/workflows`                                                                                                                    | a published package that declares no minimum, one the check cannot read, or one that no workflow names. It reads the literal, not whether that job is required or green; a private package is exempt                                                                                                                                                                                                                                |
| `ManagedFiles`        | the five files this package owns in a consumer (the release, pin-sync, env-rotation and Scorecard workflows and the Changesets config) against the installed release's templates, by meaning | a missing or drifted managed file with no complete, unexpired record in `.repo-contract/exceptions/managed-files.json` (`internal-package-contract sync` shows the difference). "Current" means equal to the installed release, not the newest; a private package is exempt                                                                                                                                                         |
| `PinConsistency`      | the `package.json` ref, the lockfile commit and every workflow's pinned SHA of this package (offline)                                                                                        | any disagreement between them, a workflow not pinned to a full SHA, or a missing or wrong `# vX` comment. It does not check that the SHA is on this repository's default branch; passes when the repo does not use this package                                                                                                                                                                                                     |
| `BranchProtection`    | `gh api` against the default branch's GitHub ruleset                                                                                                                                         | deletion, force-push or pull-request protection missing, the `contract` context missing or not strict, or review-thread resolution missing. It does not assert the `required` context and does not inspect bypass actors; `gh` unavailable is a recorded degradation                                                                                                                                                                |
| `Coverage`            | reads `Tests`' summary against `COVERAGE_THRESHOLDS`                                                                                                                                         | any measure below threshold. Under `--scope affected` it warns instead of judging                                                                                                                                                                                                                                                                                                                                                   |
| `Crap`                | `crap4ts src` — CRAP and cyclomatic ceilings (`CRAP_THRESHOLD` / `MAX_COMPLEXITY`; `dependsOn Coverage`)                                                                                     | any function over either ceiling                                                                                                                                                                                                                                                                                                                                                                                                    |
| `Size`                | `npm run size` \*                                                                                                                                                                            | the consumer's size script failing                                                                                                                                                                                                                                                                                                                                                                                                  |
| `NoMinify`            | static check of tsup config and scripts, plus inspection of `dist/` for minified code                                                                                                        | any `minify*` option, or a minified-looking built file (Socket flags minified code; no allowlist)                                                                                                                                                                                                                                                                                                                                   |
| `DistNoUrls`          | `repo-contract/presets` `distNoUrls` scanner over **every** file in `dist/` (maps, `.d.ts` too)                                                                                              | any shipped URL without a complete record in `.repo-contract/exceptions/dist-urls.json`; stale records fail                                                                                                                                                                                                                                                                                                                         |
| `Duplication`         | `jscpd src`                                                                                                                                                                                  | duplication above the budget in `checks/duplication.ts`                                                                                                                                                                                                                                                                                                                                                                             |
| `Packaging`           | `publint`                                                                                                                                                                                    | any packaging **error** (warnings warn)                                                                                                                                                                                                                                                                                                                                                                                             |
| `TypeResolution`      | `attw` on the packed tarball (`./schema` excluded)                                                                                                                                           | any packaged type-resolution problem                                                                                                                                                                                                                                                                                                                                                                                                |
| `PackedConsumer`      | the packed tarball, installed into an empty project: every promised file is in it, every export-map entry imports (and `require`s where a `require` condition exists)                        | an entry that throws or cannot be resolved, or a promised file missing from the tarball. An entry missing only a declared peer is skipped and named; an install that cannot run is not evaluated; a private package is exempt                                                                                                                                                                                                       |
| `Licenses`            | `licensee --production`, with the repository's `.licensee.json` as the policy (`--osi` without one)                                                                                          | any shipped dep without an OSI license                                                                                                                                                                                                                                                                                                                                                                                              |
| `DocsMarkdown`        | `markdownlint-cli2` — bundled `config/markdownlint.jsonc`                                                                                                                                    | any markdown issue                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `DocsLinks`           | `linkinator`, recursive: Markdown crawl from `README.md` + HTML crawl over `docs/`                                                                                                           | any broken **local** link (an unreachable external link warns until recorded; a rate-limited one, HTTP 429, passes)                                                                                                                                                                                                                                                                                                                 |
| `DocsFragments`       | bundled `scripts/check-docs-fragments.mjs`                                                                                                                                                   | a `filename.md#fragment` link whose fragment is not a real heading                                                                                                                                                                                                                                                                                                                                                                  |
| `BenchmarkGuides`     | `benchmarks/WRITING-BENCHMARKS.md` and `READING-BENCHMARKS.md` against the copies in `template/benchmarks/`                                                                                  | a copy that differs or is missing (`internal-package-contract sync-benchmark-guides` fixes it). A guide edit here drifts every consumer until it re-pins and syncs                                                                                                                                                                                                                                                                  |
| `BenchmarkComplexity` | each suite's committed `benchmarks/<suite>/results.json` against the results committed at the last release tag: the fitted big-O class of every measured group                               | a group whose class got worse with no complete, unexpired record in `.repo-contract/exceptions/benchmark-complexity.json`. A class that cannot be determined warns, never fails; no benchmarks or no release tag passes                                                                                                                                                                                                             |
| `BenchmarkCoverage`   | the public functions in the committed API baselines (`.repo-contract/api-contract`) against what each suite says it covers (`analysis.coverage` in `results.json`)                           | a public function with several inputs that no benchmark exercises and the suite does not list under `notBenchmarked`; a parameter or key the covering benchmark does not account for; a name that is no longer a public function; a package with no API baseline passes                                                                                                                                                             |
| `Accessibility`       | `pa11y` (WCAG2AA) against the consumer's own built docs site                                                                                                                                 | any accessibility violation (no built site or no Chrome → a recorded degradation)                                                                                                                                                                                                                                                                                                                                                   |
| `SecurityDeps`        | `npm audit --omit=dev` (what users install)                                                                                                                                                  | any critical advisory (never waivable); any lower one without a complete exception record. Vacuous for a package with no runtime dependencies                                                                                                                                                                                                                                                                                       |
| `SecurityDevDeps`     | `npm audit` over the whole tree, minus `--omit=dev`                                                                                                                                          | a critical advisory in development tooling; lower ones warn                                                                                                                                                                                                                                                                                                                                                                         |
| `SecuritySecrets`     | `secretlint` — bundled `config/secretlint.config.json`                                                                                                                                       | any detected secret                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `Suppressions`        | parses every source and Markdown file for suppression comments (ESLint, TypeScript, Stryker, V8/c8/Istanbul, jscpd, Prettier, markdownlint, secretlint); the full list is kept as evidence   | a suppression with no reason where it is written, a blanket one (`@ts-ignore`, `@ts-nocheck`, `eslint-disable` naming no rule), or a stale record, unless `.repo-contract/exceptions/suppressions.json` covers it. A reason is required, not judged                                                                                                                                                                                 |
| `SecuritySocket`      | `socket package score` (`@socketsecurity/cli`) on the package's own Socket page, whole transitive closure incl. peers                                                                        | any `critical` or `high` alert; every other alert needs a complete record whose `exceptionType` says what is true. **Warns** without an API key; in CI (`--strict`) that warning fails unless `environment.json` records `environment:SecuritySocket:no-key` (`init` writes one with a 90-day expiry). **Fails** on a rejected token, a network error, a rate limit or a missing `socket` CLI. Scores the version already published |
| `CodeScanning`        | open GitHub code-scanning alerts for the ref being built (your `gh` login locally; the workflow token in CI, which needs `security-events: read`)                                            | an alert in code that builds, runs or ships must be fixed; an alert in development-only code takes a standing `policy-rule` record in `.repo-contract/exceptions/code-scanning.json`; no scanning or no remote is a degradation (`environment:CodeScanning:not-enabled` / `no-remote`). Alerts open on `main` only are invisible to a pull request                                                                                  |
| `DeadCode`            | `knip` — bundled `config/knip.json`                                                                                                                                                          | any unused file, export or dependency, or an unlisted import                                                                                                                                                                                                                                                                                                                                                                        |
| `Commits`             | `commitlint origin/main..HEAD` — bundled `config/commitlint.config.mjs`                                                                                                                      | any message that is not a Conventional Commit, and any `Co-Authored-By` trailer (the bundled config's `no-co-author-trailer` rule); no base branch → warn                                                                                                                                                                                                                                                                           |
| `CodeRabbit`          | `coderabbit review --agent` on your uncommitted edits, or the committed branch diff against `origin/main` (CLI installed per machine; in CI the GitHub App reviews)                          | never on a finding: findings, stale records and an unreadable review warn. It fails only on broken evidence: an unloadable `.repo-contract/exceptions/coderabbit.json`, evidence that fails revalidation, or a review script that crashes or prints non-JSON (CI / no CLI / detached `HEAD` → warn, recorded)                                                                                                                       |
| `Mutation`            | Stryker, zero-tolerance (`isolated`)                                                                                                                                                         | any Survived, NoCoverage or Timeout mutant. Always runs: without a `stryker.config.*` the bundled baseline does. Mutants hidden by `Stryker disable` comments are counted in the rationale, not judged; the baseline sets `ignoreStatic: true`                                                                                                                                                                                      |

\* runs the consumer's own npm script; **skipped with a note** if absent. `ReadmeExample` passes when skipped,
including when the script exists but its fixture is missing (known follow-up).

**A brand-new package** (nothing but `package.json`) fails `Lint`, `Typecheck`, `Build`, `Architecture`,
`GitHygiene` and `Coverage` on its first run, each naming what is missing. This is deliberate: the `eslint` and
`tsconfig` baselines are meant to be extended by the consumer's own config, never substituted, so those checks
enforce real rules from day one. `Mutation` fails until there is something to mutate. `Accessibility` and
`BranchProtection` record a degradation instead: a warn locally, a failure under `--strict` without a record in
`.repo-contract/exceptions/environment.json`. Run `git init`, add a `tsconfig.json` and `eslint.config.mjs` that
extend this package's, and a `src/` tree.

### Not cloned from `repo-contract.config.ts`

`security-network`, `adr-governance`, and the `test-unit/integration/property/e2e` split encode repo-contract's
own design rather than a package standard.

## Exceptions

Where a package has a good reason to break a rule, the reason is a committed record in
`.repo-contract/exceptions/` that the owning check reads back every run; never a comment or a flag.
[EXCEPTIONS.md](EXCEPTIONS.md) documents the record, every registry, how a check that could not run is handled,
and `internal-package-contract exceptions`, which lists what is in force.

## Contributor setup: Socket.dev

`SecuritySocket` warns when no API key is available and fails on a rejected token, a network error, a rate
limit or a missing `socket` CLI (`checks/security-socket.ts`; `test/security-socket.test.ts`). In CI the contract runs `--strict`, so the
warning fails there unless `environment.json` records `environment:SecuritySocket:no-key`; `init` writes that
record with a 90-day expiry, so a new package is green on day one and decides about a token before it lapses.

- **On your machine:** `npm install --global @socketsecurity/cli`, then `socket login`; confirm with
  `socket config list` that `apiToken` is set.
- **In GitHub Actions:** create a Socket API token (socket.dev > Settings > API Tokens, permission
  `packages:list`), add it as the secret `SOCKET_SECURITY_API_KEY`, and map it under `env:` on the step that runs
  the contract (the scaffolded `contract.yml` does).

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
`eslint` baseline carries one rule of its own, `ipc/no-network`: nothing under `src/` imports a network module
(`http`, `https`, `http2`, `net`, `tls`, `dns`, `dgram`, `undici`, `ws`) or uses a network global (`fetch`,
`XMLHttpRequest`, `WebSocket`, `EventSource`, `navigator`). Type-only imports are allowed; a package's `bin/` or
bundled compiler is outside the rule (`test/eslint-no-network.test.ts`).

`npm` honors `overrides` only from the root project, so a fix made here does not reach a consumer. `GithubActions`
runs through `github-actionlint`, which unzips actionlint with `adm-zip@^0.5`; every `adm-zip` before 0.6.1 carries
published advisories. The `init` scaffold already adds this to the consumer's `package.json`:

```json
{ "overrides": { "adm-zip": "0.6.1" } }
```

## Customizing a check

Every check is two halves: the **evidence** (the command, its working directory, environment, timeout and output
format) and the **policy** (what that evidence has to show). Replace the half you need:

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
[benchmarks/](benchmarks) (`npm run benchmark`); no CI job runs those suites and nothing fails when a module lacks
one.

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

`--strict` is the default when `CI` or `GITHUB_ACTIONS` is set (`scripts/contract-run.mjs`); it turns an
unrecorded "not evaluated" result into a failure, and `--no-strict` turns it off. The log mode can also be set
with `IPC_LOGS` or `"internal-package-contract": { "logs": ... }` in `package.json`; a flag wins over the
environment, which wins over the package. A log file is written as soon as a check's evidence exists and its
verdict is prepended when known.

**Narrowing a run.** `--changed` chooses checks; `--scope` narrows the work inside the checks that scale with the
code (`scripts/affected-scope.mjs`; `test/affected-scope.test.ts`). With `--scope affected`, `repo-contract`'s
affected analysis finds which test files and sources the changes can reach, and then `Tests` runs only those
files, `Mutation` mutates only those sources, and `Crap` weighs only their functions. `Coverage` is a package-wide
aggregate, so a narrowed run reports it as a warning. Anything the analysis cannot place makes the run full: a
lockfile, a tool config, a module that does not parse, a dynamic `import()`, git failing. `--scope auto` narrows
on a pull request and runs everything on a push to the default branch or a release; `CI_FULL=1` forces
everything. The scope is printed first and written to `reports/contract/scope.json`; `--base <ref>` chooses the
comparison (the upstream branch, then `origin/main`). Limit: the set to mutate is built from changed files, so a
change outside `src/` that maps to a source is mutated as that source (known follow-up).

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

`init` writes [`.github/workflows/contract.yml`](template/contract.yml). Its `contract` job checks out with
`fetch-depth: 0` (so `Commits` has the base branch), grants `security-events: read`, passes the Socket key and
`GH_TOKEN`, runs `npm run contract -- --scope auto`, and uploads `reports/contract`. Two more jobs, `node-floor`
(build and test on Node 22, the declared `engines.node` floor) and `typescript-7` (type-check under TypeScript 7),
feed a `required` job that fails unless both finished `success`.

What the ruleset requires decides what blocks a merge. `init --github` writes a ruleset requiring `contract` and
`required`, both pinned to the GitHub Actions app (`scripts/github-repo.mjs`). A repository that predates that
must add `required` itself; the three current consumers require `contract` and `lint` only, so `node-floor` and
`typescript-7` are advisory there until they do. `BranchProtection` checks for `contract` only. The `ci-jobs-test`
managed copy proves every job is in `required.needs`, not that `required` blocks a merge. The template is not a
managed file: a consumer may edit it without `ManagedFiles` noticing.

## Release

`init` writes [`.github/workflows/release.yml`](template/release.yml), a thin caller of this repository's
[`release-npm-changesets.yml`](.github/workflows/release-npm-changesets.yml), pinned by full commit SHA with the
release tag in a comment. A fix in the reusable workflow reaches a consumer when the consumer re-pins that SHA
(`dependency-pin-sync.yml` opens that pull request); nothing reaches a consumer without a change in its own
repository. The caller needs the `version` and `release` scripts and the consumer's npm trusted publisher registered.
`init` writes `.changeset/config.json` but not those scripts, and never registers the publisher. Pass `roll-floating-major-tag: false` for an npm-only consumer with no composite GitHub Action.

The reusable workflow is three jobs (`test/release-workflow.test.ts` pins the shape):

1. `version` holds no npm identity. It generates a changeset for a commit that has none (from its Conventional
   Commit type, and a `Changeset: <bump>` trailer overrides; below 1.0.0 a generated bump never exceeds minor), opens or updates the "chore: version packages"
   pull request and dispatches CI on it. A person merges it; a major crossing is a `::notice`, not a block.
2. `build` is read-only. It installs with `--ignore-scripts` and runs `npm run verify` when the package defines it.
   It requires a workflow run on a commit with exactly this tree to have finished a job named `contract` with
   success. It then runs `PromptBlocks` under `IPC_RELEASE=1`, packs the tarball and installs it into a clean
   project. The contract step was added in 0.17.0 and no real release has run through it yet. It looks for
   `contract`, not `required`.
3. `publish` checks out and installs nothing. From the default branch only, it publishes the exact tarball with
   OIDC and provenance (no `NPM_TOKEN`). It then tags the release, moves the floating `v<major>` tag within its
   major and creates a GitHub Release (`continue-on-error`). It fails unless npm serves the version with its
   attestation.

A consumer whose `typedoc.json` makes it an `ApiContract` target also needs a thin caller of
[`api-baseline-sync.yml`](.github/workflows/api-baseline-sync.yml) (`on: pull_request`, gated on
`github.head_ref == 'changeset-release/main'`), so the committed baseline tracks each release's real version.

## Moving to a new release

`internal-package-contract upgrade vX.Y.Z` installs the release, re-pins the workflows that call its reusable
workflows, brings the managed files up to date (`sync --apply --update`), regenerates the landing page and copies
the benchmark guides. It stops at the first failing step and leaves everything as uncommitted changes
(`test/upgrade.test.ts`). The reusable `dependency-pin-sync.yml` uses it when the installed release has it.

Each consumer's `sync-internal-package-contract.yml` runs daily with its own token, opens nothing when the pin is
current, and re-pins workflows in the same pull request. GitHub does not let `GITHUB_TOKEN` push a change to
`.github/workflows/*`, so a pin that moves a workflow SHA needs `PIN_SYNC_TOKEN`: a fine-grained token with
"Contents", "Pull requests" and "Workflows" write access. Without it the run falls back to `GITHUB_TOKEN` and
cannot push the workflow change. On 2026-11-12 env-cap and data-cap `main` pin v0.16.0 and repo-contract pins v0.13.3;
the v0.17.0 pull requests are open.

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
2. the package's **overhead relative to its own bare baseline** growing past an allowance: 50% for
   millisecond-scale work, 70% for microsecond-scale work. A package tunes the allowance with a `GATES` export
   in `benchmarks/budgets.mjs`.

The paired form of gate 2 ships in the first release after v0.17.0 (declared minor by
`.changeset/accurate-overhead-gate.md`); a consumer gets it when it re-pins. The baseline and the package are
sampled interleaved (A B, B A, ...), so the overhead is a per-pair difference with a 95% interval, and growth
inside the intervals of the two runs compared is a note, not a failure (`scripts/benchmark/kit/measure.mjs`;
`test/benchmark-measure-exact.test.ts`). The reference judged is `main`, measured on the same runner in the same
job at the typical size; committed results of `main` and the last release are judged only on the same CPU model
and reported otherwise. A suite `main` lacks has no reference and is reported, not judged.

A function whose big-O **cannot be determined** is a warning that says why, in the pull-request comment and in
`BenchmarkComplexity`, never a failure. There is no threshold on a raw time anywhere. Whether a red benchmark
job blocks a merge is the consumer ruleset's decision; no consumer requires `benchmark-pr` today.

### Every input of every public function

`BenchmarkCoverage` reads the committed API baselines (`.repo-contract/api-contract`) and fails until each public
function with several inputs is benchmarked and each parameter or key is accounted for in `covers`: `swept`,
`sweep:<variable>`, `variant:<name>`, `fixed: <why>` or `not covered: <why>`. A function with no benchmark is
listed under the suite's `notBenchmarked` with its reason; a name that is no longer public is stale and fails.
See `benchmarks/WRITING-BENCHMARKS.md`.

### The workflows

- [`benchmark-pr.yml`](.github/workflows/benchmark-pr.yml) (reusable): on a pull request from the same
  repository, never a bot's, it builds, runs `npm run benchmark:check` and the benchmarks, and measures `main`'s
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
  against the exception registry; `BenchmarkComplexity` and the pull-request gate both use it.
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
and one `--history "<label>|<file>"` per history file). The contract runs it before the checks whenever the package
defines it, so a link check behaves the same on a clean checkout, a laptop and in CI.

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

Two more regions read the same file. `dependencies` states what installing the package adds, from `package.json`
itself, with the reason for each from `"dependencies"` in `docs/surface.json`; a dependency without a reason, or
a reason for a package no longer declared, fails generation. `standards` lists the standard-format documents the
package generates, one row per entry in `"standards"`; generation fails when the cited test file does not exist
(`test/generate-standards.test.ts`). It checks that the file exists, not that it validates the format.

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
writes nothing; `GeneratedRegions` runs it and fails on a stale region, on markers that are missing, repeated or
out of order, and on a source that disagrees with `exports`. Only the documents listed in
`scripts/generate/documents.mjs` are read. `add export <name>` adds a new entry point to `docs/surface.json` as
`Experimental` with a `TODO:` purpose.

A scaffold asks for what only its author knows with `<!-- ipc:prompt: ... -->` (or a `TODO:` value in
`docs/surface.json`). `PromptBlocks` warns while any is left and fails under `IPC_RELEASE=1`, which the release
`build` job sets. It checks that a question is gone, never that the answer is good.

`internal-package-contract new adr "<title>"` starts a decision record in `specs/decisions` (or `docs/decisions`,
`docs/adr`) with the next number and the sections every record has.

## Optional checks

A check that not every package needs is off until the package names it: `internal-package-contract add check
AmbientCapabilities` writes the name under `"internal-package-contract"."checks"` in `package.json`, with its
settings beside it. `init` never turns one on.

`AmbientCapabilities` reads the tarball npm would publish and fails if a shipped file reaches `node:fs`,
`node:child_process` or `process.env` outside the entry points listed for that capability, or declares a
forbidden dependency. Each capability lists its allowed entry points (`"bin"`, or an export such as `"./node"`);
a capability that is not listed is not checked.

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

The example is taken from a real file, no longer than `LONGEST_EXAMPLE` in `scripts/skill/inspect.mjs`. `when` is at most 300 characters. `add check AgentSkill`
turns on `AgentSkill`, which fails on a stale, invalid or over-budget skill. It judges shape and size, never
whether the advice is good; nothing measures whether a skill makes an agent more accurate.

## Build and release helpers

The scripts every package used to copy run from here as `internal-package-contract tool <name>`:

- `size`: fails when an entry point is over its gzip budget, the default export of `ci/size-budgets.mjs`.
  `--json <file>` also writes the sizes.
- `badges`: writes the coverage and size badges from their summaries.
- `api-report`: fails when `docs/api-report/` is not what `typedoc.markdown.json` generates.
- `cjs-interop`: makes `require()` of the built ESLint plugin return the plugin.
- `compiler-isolation`: fails when a client entry can reach the bundled TypeScript compiler.
- `ambient`: the `AmbientCapabilities` answer, without the contract.

## Shared files

Files that are the same in every package are managed copies: one place to change, a drift check for the rest.
The workflows (`release`, `scorecard`, `env-rotation`, `sync-internal-package-contract`) and
`.changeset/config.json` are always managed (`scripts/managed-files/inspect.mjs`; `test/managed-files.test.ts`).
Opt-in copies, enrolled with `sync --add <name>` and restored with `sync --apply --update`: `.editorconfig`,
`typedoc.markdown.json`, `benchmarks/budgets.mjs`, the two benchmark guides, the shared runtime modules under
`src/_ipc/`, and the official schemas a package's tests validate against (`schema-sarif-2.1.0`,
`schema-oscal-assessment-results-1.1.2`, `schema-cyclonedx-1.6` with its SPDX and JSF references), carried into
`test/fixtures/standards/` with a README that records each release URL and SHA-256
(`test/standard-schemas.test.ts` fails if a byte changes). Two test-support copies carry a gate into each package's
own suite: `ci-jobs-test` fails when a job of `ci.yml` is not waited for by `required`, and `vm-bundle` runs a
browser bundle in a `vm` context with no Node globals.

### Documenting the environment

`internal-package-contract env` writes `docs/ENVIRONMENT.md` from `ci/env.schema.ts`, the credentials and
settings a package depends on, read with env-cap and never run. What the standard itself reads (`PIN_SYNC_TOKEN`,
`SOCKET_SECURITY_API_KEY`, its tool settings) is declared once in this package's own `ci/env.schema.ts`, which
env-cap's cross-package discovery includes in every consumer's document. A package's own file holds only what is
particular to it. The scaffold adds `docs:env` and a weekly `env-rotation.yml` that opens one issue when a
credential with an `expiresAt` is due and closes it when nothing is. Nothing in it is required: every variable has
a default, no manifest is generated, and `EnvContract` warns at most. `env --check` exits 1 when the document is
out of date, for a script that wants to gate on it.

### env-cap and data-cap, carried by this package

Every entry point of `env-cap` and `data-cap` is handed on, so a consumer installs neither and lists neither
(`test/reexports.test.ts` checks each is the very module the package ships):

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
enforces the layout: **Why it exists**, **How it differs**, **What it does** (with `### See it run`), **Install
and verify**, **Fit and capabilities**, **Limits and when not to use it**, **Security and supply chain**,
**Maturity, versioning and support**, **Documentation** and **Next steps** (Evaluate, Integrate, Verify); the
seven badges (CI, npm, coverage, mutation, Scorecard, Socket, license); 220 lines at most. It checks presence,
not the values: the coverage and mutation badges read JSON the package publishes to its Pages site, with a
details file beside each (`coverage.json`: the lowest of four measures; `mutation.json`: the share of applicable
mutants detected; `size.json`). `scripts/run-mutation-badge.mjs` writes `docs/mutation-badge.json` from the
Stryker report. Whether the prose is true stays a human review.

## What stands between a change and a release

A release is gated by evidence that already exists, not by a second system.

| Requirement                                                                    | Enforced by                                                                                   | Limit                                                                          |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Quality gates pass; the branch cannot merge red                                | the consumer's `contract` job, required by its ruleset; `BranchProtection` checks the ruleset | admin bypass by pull request; `required` is not required in any consumer today |
| API and surface changes carry the right bump                                   | `ApiContract`, `SurfaceContract`; a human merges the release pull request                     | behaviour behind an unchanged signature is unseen                              |
| Package metadata, license and contents are right                               | `Packaging`, `Licenses`, `GitHygiene`, `DistNoUrls`, `Size`                                   |                                                                                |
| The published types resolve under every module mode                            | `TypeResolution` on the packed tarball                                                        |                                                                                |
| What npm would ship installs and imports for a consumer                        | `PackedConsumer`; the same script on the exact tarball in the release `build` job             | peer-dependent entries are skipped in both places                              |
| The declared minimum Node.js is tested                                         | `EngineMatrix`                                                                                | reads the literal, not whether the job is required                             |
| Workflows and config this package owns have not drifted                        | `ManagedFiles`; `sync` shows the difference and restores only when told                       | "current" means the installed release                                          |
| Third-party actions are pinned; pins agree                                     | `GithubActions`, `PinConsistency`                                                             | offline; the SHA is not checked against this repository's branches             |
| Publishing uses OIDC, no stored token, the pinned npm, the exact built tarball | `release-npm-changesets.yml` (`test/release-workflow.test.ts`)                                | the 0.17.0 path has not produced a real release yet                            |
| Publishing happens only from the default branch                                | the `publish` job's `if`                                                                      |                                                                                |
| The registry serves the version with its provenance attestation                | the last step of the `publish` job                                                            |                                                                                |
| The package's security posture is visible and scored                           | `SecurityDeps`, `SecuritySocket`, `ScorecardWorkflow`, `CodeScanning`                         | Socket scores the published version                                            |
| The README answers whether to adopt it                                         | `ReadmeStructure`                                                                             | structure only                                                                 |

A single "release readiness" verdict would repeat the contract's own report, and a managed-file list covering the
whole scaffold would report drift in files a package is meant to change. So `init` stays non-destructive, `sync`
is a separate act from checking, and the managed list is five files compared on what they mean.

## Describing a change once

`internal-package-contract report` reads the evidence a package already holds and writes the pull-request
account as Markdown (`test/change-report.test.ts`): what changed by area, each new changeset with its bump, the
decision records added, the exceptions recorded or retired, the dependencies moved, and what each check said in
the last contract run. It ends with what no local run can see (CodeRabbit's review, GitHub's settings, the
benchmark job, the CI jobs the contract does not run), so none of those is assumed to have passed. Nothing in it
is written by hand. `report --base <ref>` measures against another ref (default `origin/main`); `--out <file>`
writes it. Run the contract first, or the report says that it has not been run.

## Changing the standard without breaking what depends on it

`internal-package-contract verify-consumers <checkout>...` runs each consumer's fast offline checks twice in
throwaway copies, once with the standard the package has installed and once with this one, and names every
check that got worse (`test/verify-consumers.test.ts`). A check that fails both ways is not blamed on the change;
the checkout is never touched. The network and service checks, coverage, CRAP and mutation are not run; `--skip
a,b` leaves out more and `--keep` keeps the copies. It also says where an install would add its own copy of a
package the standard depends on. It runs on demand only, never in CI: running it on every pull request needs a
token that can read the four repositories.

## Mutation testing

The check always runs every mutant, whatever a package's `incremental` setting says: a result carried over from
other conditions can pass a gate a cold run would fail, as one did here (`test/mutation.test.ts`). A run over
inputs that have not changed is not run twice. When a clean run was kept for the same hash of every file git does
not ignore and of the Node.js version, its evidence is put back and judged as a fresh one. The memo never applies
under CI, and `IPC_MUTATION_MEMO=0` runs regardless; only a run in which every mutant was caught or left out is
kept (`test/mutation-memo.test.ts`). While writing, `internal-package-contract mutation` mutation-tests only what
a change touched; only the full check can say a change is finished.

A mutant that times out is run again alone before the timeout counts (at most five are); one caught the second
time is recorded as caught, one that times out again stays a failure (`test/mutation-confirm-timeouts.test.ts`).

When the run does not fit in one job, split it. `IPC_MUTATION_SHARD=i/n` mutates slice `i` of `n`, cut
heaviest-first by size, the same way every time. A record in `mutation.json` for a mutant in another slice is not
called stale. Merge with `node node_modules/internal-package-contract/scripts/run-merge-mutation-reports.mjs
--total <n> --out reports/mutation/mutation.json 1=<report> 2=<report> ...`; it writes nothing and fails when a
slice is missing, repeated, unreadable, or overlaps another (`test/mutation-merge.test.ts`). Then a full run with
`IPC_MUTATION_REPORT=<merged report>` judges that report instead of mutating. It adopts a report only when every
mutant has a status, the file set matches a full run of this checkout, and each file's text matches disk
(`test/mutation-adopt.test.ts`); whatever it refuses, the previous evidence is removed first. A file the plan has
and the report lacks is accepted exactly when Stryker's instrumenter finds no mutant in it. data-cap is the only
consumer that shards today; no template workflow does.

## Stability: what a release promises

A release's version tells a consumer whether `npm run contract` can start failing:

- **patch**: a fix that makes a check more correct for a package that already satisfies the standard;
- **minor**: a new check or a stricter rule, a new export, flag or subcommand; below 1.0.0 a stricter rule is a
  patch-level bump, as for any 0.x package;
- **major**: removing or renaming a check id, a subcommand, a flag or an export; changing the shape of an
  exception record or of the report in `reports/contract/`.

What a gate holds to that: the check ids (`test/contract.test.ts`), and the `--help` text and exit codes of the
CLI (`SurfaceContract` on this repository, baseline in `.repo-contract/surface-contract/baseline.json`). The
`./checks/*`, `./logs`, `./config/*`, `./eslint`, `./prettier`, `./tsconfig` and `./benchmark` exports, the
exception-record format ([EXCEPTIONS.md](EXCEPTIONS.md)), the `check-*.mjs` output envelopes and
`evidence.json` / `report.json` are intended to follow the same levels, but nothing diffs them: review decides.
Everything else under `scripts/` is an implementation detail.

There is no documentation website: this package is not published, so its README, [EXCEPTIONS.md](EXCEPTIONS.md),
[TOOLKIT.md](TOOLKIT.md), [SECURITY.md](SECURITY.md), [CONTRIBUTING.md](CONTRIBUTING.md) and the guides in
`template/` are its documentation.

## Bootstrap order

IPC depends on the published `repo-contract` (`~0.12.0` in `package.json`) at runtime: every check is a
`repo-contract` check. `repo-contract` declares IPC as a development dependency
(`github:MaverickCER/internal-package-contract#<tag>`) and consumes its API-contract engine and benchmark kit.
Neither needs the other's unreleased code, because `repo-contract`'s self-contract runs against its own fresh
`dist/` while IPC resolves the published package. The upgrade order for a breaking `repo-contract` change:

1. publish the new `repo-contract`;
2. bump IPC's `repo-contract` dependency and release IPC (a new tag);
3. re-pin `repo-contract`'s own IPC devDependency to that tag.

The rationale is [`repo-contract` ADR 0018](https://github.com/MaverickCER/repo-contract/blob/main/specs/decisions/0018-ecosystem-bootstrap-cycle-and-package-names.md).

## Evolving the standard

Per ADR 0010: a review finding becomes a new check here only when it exposes a repeatable error class that
affects packages and can be mechanically detected. One-off fixes stay in the package that found them.
