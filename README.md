# internal-package-contract

The engineering standard every publishable MaverickCER package (`repo-contract`,
`@maverickcer/env-cap`, `data-cap`) must **continuously satisfy** — and the
configs, git wiring, and one-command setup to adopt it. A clone of repo-contract's own
[`repo-contract.config.ts`](https://github.com/MaverickCER/repo-contract/blob/main/repo-contract.config.ts),
adapted to govern a _consuming_ package.

It is the "package" row of the layered governance model
([repo-contract ADR 0010](https://github.com/MaverickCER/repo-contract/blob/main/specs/decisions/0010-review-driven-contracts-and-shared-internal-system-contracts.md)):

| Layer                           | Owns                                       | Answers                                         |
| ------------------------------- | ------------------------------------------ | ----------------------------------------------- |
| `repo-contract`                 | execution, evidence, policy mechanism      | _How_ is a requirement turned into a verdict?   |
| **`internal-package-contract`** | the standard for a publishable package     | _What_ must every package continuously satisfy? |
| `env-cap`, `data-cap`, …        | package-specific checks and implementation | _What else_ does this one package require?      |

## Part of the MaverickCER toolkit

`@maverickcer/env-cap` governs configuration and `data-cap` governs application data: siblings that apply the same capability-ownership model. `repo-contract` and `internal-package-contract` are how they are verified. See [the toolkit overview and glossary](https://github.com/MaverickCER/internal-package-contract/blob/main/TOOLKIT.md).

**Not published to npm**, by choice: it is an internal standard whose checks
change with the fleet, and a git dependency (pinned to a release tag or commit)
is the only distribution it needs. It does depend on `repo-contract`'s
published runtime, and `repo-contract` in turn consumes IPC's API-contract
engine and benchmark kit as a _development_ dependency — a deliberate bootstrap
cycle, described in [Bootstrap order](#bootstrap-order) below. Consumers depend
on it with a `file:` / git range and get
`repo-contract`, every executor, and every tool config transitively for
**`npm run contract` itself** — one devDependency, no extra installs needed to
run the contract (`bin/contract.mjs` prepends every `node_modules/.bin` it
finds, including this package's own nested one, so `eslint`/`tsc`/`vitest`/etc.
resolve even though a plain `file:` dependency's own dependencies are never
`npm`-hoisted into the consumer's tree).

That transitivity does **not** extend to the consumer's _own_ scripts or to
TypeScript's own type resolution, both of which only ever look in the
consumer's own `node_modules` (never a dependency's nested one): a consumer
that runs `build`/`test` outside of `npm run contract`, or that extends the
bundled `internal-package-contract/tsconfig` baseline (which sets
`"types": ["node"]`), needs its own `typescript`, `@types/node`, and
`vitest`/`@vitest/coverage-v8` devDependencies too — exactly what every
current real consumer (env-cap, data-cap) already has. Add them alongside
`internal-package-contract`.

## Adopt it

One command, in an existing package or in an empty directory:

```sh
# an existing package: bring it under the standard
npx github:MaverickCER/internal-package-contract init

# a new package, in an empty directory
npx github:MaverickCER/internal-package-contract init --name @scope/pkg --owner MyOrg
```

`init` ends with `doctor`, a read-only report of what is set up, what to run next, and the steps only a person can
take. Run `doctor` again whenever you want it; running `init` again is safe and finishes whatever is missing.

**In an existing package** `init` adds the pin and the `contract` script, and the scripts, tools and overrides the
checks need; installs; scaffolds the hygiene files, the contract, release, Scorecard and pin-sync workflows, the git
hooks and the Changesets config; writes every config, document and template the package lacks (never overwriting
one it has); drafts `docs/surface.json`, keeping what a hand-written API table says; starts adoption mode; and
generates the API map. **In an empty directory** `--name` scaffolds a complete package from
[`template/package/`](template/package), installs, scaffolds again with the pin the lockfile names, generates, and
runs `doctor`.

Flags: `--dry-run` prints the plan and changes nothing. `--strict` skips adoption mode, so every check can fail the
run from the start. `--github` also applies branch protection through the `gh` CLI; without it no repository
setting is changed. `--docs` takes the standard's version of a shared document the package already has, instead of
only naming it. `--tag vX.Y.Z` or `--spec <dependency spec>` chooses what to pin. `--owner` and `--description`
fill in the package's repository and description. `--force` overwrites scaffolded files that already exist.

**Adoption mode.** A package that adopts starts with every check reporting what it finds, but only the checks it has
promoted deciding the exit code, so the first run is a list of things to fix and not a wall. `init` writes
`.repo-contract/adoption.json` (ninety days, nothing promoted). While it is active a failing check is still a
`FAIL`, with its whole reason (`FAIL (advisory)` on the console, `advisory` in the summary and report), and the run
exits 0. Nothing is softened: each policy reports exactly what it will report once it is enforced.
`internal-package-contract promote <Check>` makes a check strict: its failure fails the run from then on, and
`promote --all` ends the mode. The `AdoptionMode` check warns with the days left and fails once the date has
passed, so "adopting" cannot become permanent.

`init` refuses to start over uncommitted changes, never overwrites a file the package has, and leaves everything as
uncommitted changes to review, so `git restore .` undoes it. A shared document the package has that differs from the
standard's is named and left alone. Three kinds of step cannot be scripted and are listed by `doctor` with the exact
values to enter: registering npm's trusted publisher, the repository's settings and secrets, and installing the
review apps.

**Working on the standard itself.** To try a local checkout in a package, install it as a copy:
`npm install --install-links --save-dev file:../internal-package-contract`. A plain `file:` dependency is a symlink,
which makes the standard resolve its own tools from the wrong `node_modules` (a missing `typedoc`, a duplicated
ESLint plugin) and fails in ways that look like bugs in the package. `doctor` says so when it finds one.
Otherwise pin a release tag, `github:MaverickCER/internal-package-contract#v0.8.1`, not `#main`.

There's no programmatic import of this package -- `contract.ts` ships as raw
TypeScript (Node refuses to type-strip `.ts` under `node_modules`, so a plain
`import("internal-package-contract")` doesn't work), and nothing in this
fleet needs one. The `internal-package-contract` CLI (which loads
`contract.ts` internally via `tsx`) is the one supported way to run it; use
`./eslint`, `./prettier`, `./tsconfig`, and `./config/*` for the individual
tool configs.

**Bundled git hooks** (installed by `init` or by running `internal-package-contract install-hooks` once per clone -- never by an install script; `GitHooks` warns when they are missing; a local convenience: CI runs the same contract and is the
gate, so a hook that is skipped locally is still caught before merge):

| Hook         | Runs                                                                 |
| ------------ | -------------------------------------------------------------------- |
| `pre-commit` | the entire contract, slow analyses included                          |
| `commit-msg` | Conventional Commits check on the message                            |
| `pre-push`   | everything except the slow analyses (`Coverage`, `Crap`, `Mutation`) |

## The checks

[`contract.ts`](contract.ts) — the authoritative list is its `checks:` object;
the tables below describe each one. Read-only against the consumer's source tree.
`Build` / `Tests` write only build + coverage + report artifacts, which
[`bin/contract.mjs`](bin/contract.mjs) cleans up. Every tool that needs a config
uses the consumer's own if present, **otherwise a bundled default from
[`config/`](config/)** — so the contract enforces real rules on day one.

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

`Build` — `npm run build`, `isolated`. Writers finish first; readers wait, so
the packaging checks see a fresh `dist/`.

### 3 — Readers (concurrent)

| Check                 | How                                                                                                                                                                                                                                                   | Blocks on                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ApiContract`         | diffs every target's public API against its committed baseline (needs `dist/.dts/`)                                                                                                                                                                   | the branch's changesets declaring a smaller bump than the diff actually requires                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `SurfaceContract`     | the `--help` and exit code of each `bin`, the JSON Schemas `exports` serve and the inputs and outputs of `action.yml`, against `.repo-contract/surface-contract/baseline.json`                                                                        | a surface change the branch's changesets do not declare a large enough bump for, or (in CI) a surface with no committed baseline; passes when the package has none of these                                                                                                                                                                                                                                                                                                                      |
| `Typecheck`           | `tsc --noEmit -p tsconfig.json`                                                                                                                                                                                                                       | any type error                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `CleanCheckout`       | the package's own type check on only what git tracks, with this installation's dependencies                                                                                                                                                           | a file hidden by `.gitignore` or never added passes every check that reads the working tree and fails CI and every consumer                                                                                                                                                                                                                                                                                                                                                                      |
| `Tests`               | `vitest run` **with** V8 coverage, once                                                                                                                                                                                                               | any failing / errored test                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `Architecture`        | `depcruise src` — bundled `config/dependency-cruiser.cjs`                                                                                                                                                                                             | any error-severity violation (circular deps, etc.)                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `GithubActions`       | `github-actionlint` (npm wrapper for actionlint)                                                                                                                                                                                                      | any workflow finding (no workflows → pass)                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `GitHygiene`          | tracked build output, conflict markers, `.gitignore` gaps, `package.json` `files`, and an import of a file git does not track (so a clean checkout lacks it)                                                                                          | a repo-maintenance defect                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `GitHooks`            | `core.hooksPath` against the bundled hooks (local only)                                                                                                                                                                                               | never fails: warns when the hooks are not installed, with the one command that installs them; passes in CI                                                                                                                                                                                                                                                                                                                                                                                       |
| `LandingPage`         | `docs/site.json` against the landing-page quality bar, and the generated `docs/index.html`, `brief.html`, `styles.css`, `script.js` against what it produces                                                                                          | invalid content, or generated files that differ from it; passes when the package has no `docs/site.json`                                                                                                                                                                                                                                                                                                                                                                                         |
| `AdoptionMode`        | whether `.repo-contract/adoption.json` says the package is adopting the standard                                                                                                                                                                      | a warning while adopting (with the end date and what is enforced); a failure once the period has ended or the file is invalid; passes when the package is not adopting                                                                                                                                                                                                                                                                                                                           |
| `GeneratedRegions`    | the regions a document marks as generated (`<!-- ipc:begin entry-points -->`), against what `package.json` and `docs/surface.json` produce                                                                                                            | a stale region, malformed markers, or a `docs/surface.json` that omits an exported entry point or lists one that is not exported (`internal-package-contract generate` rewrites them); passes when no document has a region                                                                                                                                                                                                                                                                      |
| `PromptBlocks`        | questions a scaffold left for its author (`<!-- ipc:prompt: ... -->`) in the documents and decision records                                                                                                                                           | a warning while any is unanswered; a failure when a release is being verified (`IPC_RELEASE=1`)                                                                                                                                                                                                                                                                                                                                                                                                  |
| `EnvContract`         | `ci/env.schema.ts`, the credentials and settings the package depends on, read (never run) with env-cap, which this package carries, and `docs/ENVIRONMENT.md` generated from it                                                                       | a warning for a credential that is expiring or has expired, or a generated file that is out of date; a package with no contract passes, and nothing in it is required                                                                                                                                                                                                                                                                                                                            |
| `ReadmeStructure`     | `README.md` against the shared adoption layout: the ten sections in order, the trust badges (CI, npm, coverage, mutation, Scorecard, Socket, license), a real-output demo and Evaluate/Integrate/Verify next steps, within 220 lines                  | a missing, extra or misordered section, a missing badge, or a README past the limit; a private package is exempt                                                                                                                                                                                                                                                                                                                                                                                 |
| `ScorecardWorkflow`   | `.github/workflows` for a workflow that runs `ossf/scorecard-action` pinned to a commit, with `publish_results: true`, the `id-token: write` permission and a schedule                                                                                | no such workflow, or one that cannot publish its result; a private package is exempt                                                                                                                                                                                                                                                                                                                                                                                                             |
| `EngineMatrix`        | `engines.node` against the Node.js versions `.github/workflows` actually run on                                                                                                                                                                       | a published package that declares no minimum, one the check cannot read, or one that no workflow tests; a private package is exempt                                                                                                                                                                                                                                                                                                                                                              |
| `ManagedFiles`        | the few files this package owns in a consumer (the release workflow, the pin-sync workflow, the Changesets config) against the standard's, comparing what they mean rather than their bytes (comments, blank lines and the pinned commit are ignored) | a missing or drifted managed file with no complete, unexpired record in `.repo-contract/exceptions/managed-files.json` (`internal-package-contract sync` shows the difference); a private package is exempt                                                                                                                                                                                                                                                                                      |
| `PinConsistency`      | the `package.json` ref, the lockfile commit and every workflow's pinned SHA of this package (offline)                                                                                                                                                 | any disagreement between them, a workflow not pinned to a full SHA, or a missing or wrong `# vX` comment; passes when the repo does not use this package                                                                                                                                                                                                                                                                                                                                         |
| `BranchProtection`    | `gh api` against the default branch's GitHub ruleset                                                                                                                                                                                                  | deletion / force-push / PR-required protection, the `contract` required status check (strict), or required review-thread resolution missing (`gh` unavailable is a recorded degradation)                                                                                                                                                                                                                                                                                                         |
| `Coverage`            | reads `Tests`' summary vs. `COVERAGE_THRESHOLDS`                                                                                                                                                                                                      | any metric below threshold                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `Crap`                | `crap4ts src` — CRAP and cyclomatic ceilings (`CRAP_THRESHOLD` / `MAX_COMPLEXITY`; `dependsOn Coverage`)                                                                                                                                              | any function over either ceiling                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `Size`                | `npm run size` \*                                                                                                                                                                                                                                     | the consumer's size script failing                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `NoMinify`            | static check of tsup config / scripts + inspection of `dist/` for minified code                                                                                                                                                                       | any `minify*` option, or a minified-looking built file (Socket flags minified code; 0 minification is allowed; no allowlist)                                                                                                                                                                                                                                                                                                                                                                     |
| `DistNoUrls`          | `repo-contract/presets` `distNoUrls` scanner over **every** file in `dist/` (maps, `.d.ts` too)                                                                                                                                                       | any shipped URL without a complete record in `.repo-contract/exceptions/dist-urls.json` (stubs scaffolded; stale records fail)                                                                                                                                                                                                                                                                                                                                                                   |
| `Duplication`         | `jscpd src`                                                                                                                                                                                                                                           | duplication above the budget in `checks/duplication.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `Packaging`           | `publint`                                                                                                                                                                                                                                             | any packaging **error** (warnings warn)                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `TypeResolution`      | `attw` on the packed tarball (`./schema` excluded)                                                                                                                                                                                                    | any packaged type-resolution problem                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `PackedConsumer`      | the packed tarball, installed into an empty project: every file `package.json` promises is in it, every export-map entry imports (and `require`s, where a `require` condition exists), JSON entries with a JSON import attribute                      | an entry that throws or cannot be resolved, or a promised file missing from the tarball; an entry missing only a declared peer is skipped and named, an install that cannot run is not evaluated, a private package is exempt                                                                                                                                                                                                                                                                    |
| `Licenses`            | `licensee --production --osi`                                                                                                                                                                                                                         | any shipped dep without an OSI license                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `DocsMarkdown`        | `markdownlint-cli2` — bundled `config/markdownlint.jsonc`                                                                                                                                                                                             | any markdown issue                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `DocsLinks`           | `linkinator`, recursive: Markdown crawl from `README.md` + HTML crawl over `docs/`                                                                                                                                                                    | any broken **local** link (an unreachable external link warns until recorded; a rate-limited one, HTTP 429, passes)                                                                                                                                                                                                                                                                                                                                                                              |
| `DocsFragments`       | bundled `scripts/check-docs-fragments.mjs`                                                                                                                                                                                                            | a `filename.md#fragment` link whose fragment isn't a real heading (a gap neither `DocsMarkdown` nor `DocsLinks` covers)                                                                                                                                                                                                                                                                                                                                                                          |
| `BenchmarkGuides`     | compares `benchmarks/WRITING-BENCHMARKS.md` and `READING-BENCHMARKS.md` with the canonical copies in `template/benchmarks/`                                                                                                                           | a copy that differs or is missing (`internal-package-contract sync-benchmark-guides` fixes it)                                                                                                                                                                                                                                                                                                                                                                                                   |
| `BenchmarkComplexity` | each suite's committed `benchmarks/<suite>/results.json` against the results committed at the last release tag: the fitted big-O class of every measured group                                                                                        | a group whose class got worse (linear to quadratic, say) with no complete, unexpired record in `.repo-contract/exceptions/benchmark-complexity.json` accepting that group growing to that class; no benchmarks or no release tag passes                                                                                                                                                                                                                                                          |
| `BenchmarkCoverage`   | the public functions in the committed API baselines (`.repo-contract/api-contract`) against what each benchmark suite says it covers (`analysis.coverage` in `benchmarks/<suite>/results.json`)                                                       | a public function with several inputs (several parameters, or an object with several keys) that no benchmark exercises and the suite does not list under `notBenchmarked`; a parameter or key the covering benchmark does not account for; a name that is not (or no longer) a public function; a suite whose results predate `analysis.coverage`; a package with no API baseline passes                                                                                                         |
| `Accessibility`       | `pa11y` (WCAG2AA) against the consumer's own built docs site                                                                                                                                                                                          | any accessibility violation (no built site to scan → warn)                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `SecurityDeps`        | `npm audit --omit=dev` (what users install)                                                                                                                                                                                                           | any critical advisory (never waivable); any lower one without a complete exception record                                                                                                                                                                                                                                                                                                                                                                                                        |
| `SecurityDevDeps`     | `npm audit` over the whole tree, minus `--omit=dev` (the development and CI tooling)                                                                                                                                                                  | a critical advisory in development tooling; lower ones warn                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `SecuritySecrets`     | `secretlint` — bundled `config/secretlint.config.json`                                                                                                                                                                                                | any detected secret                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `Suppressions`        | parses every source and Markdown file for suppression comments (ESLint, TypeScript, Stryker, V8/c8/Istanbul coverage, jscpd, Prettier, markdownlint, secretlint); the full list is kept in the evidence                                               | a suppression with no reason where it is written, a blanket one (`@ts-ignore`, `@ts-nocheck`, `eslint-disable` naming no rule), or a stale record — unless a complete record in `.repo-contract/exceptions/suppressions.json` covers it                                                                                                                                                                                                                                                          |
| `SecuritySocket`      | `socket package score` (`@socketsecurity/cli`) — the package's own Socket page, whole transitive closure incl. peers                                                                                                                                  | any `critical`/`high` alert is forbidden; every other alert, `supplyChainRisk` included, needs a complete exception record whose `exceptionType` says what is actually true (`validated-false-positive` with a mechanical re-verification, `tooling-limitation`, `accepted-risk`, or `required-for-package-to-exist`). **Fails** when Socket can't run in CI (and for a rejected token, network or rate limit anywhere); **warns** when a developer machine has no API key, with the setup steps |
| `CodeScanning`        | open GitHub code-scanning alerts for the ref being built (your `gh` login locally; the workflow token in CI, which needs `security-events: read`)                                                                                                     | an alert in code that builds, runs or ships must be fixed (no exception); an alert in development-only code (tests, unpublished `scripts/`, docs, `.github/`, configs) is rejected with a standing `policy-rule` record in the committed `.repo-contract/exceptions/code-scanning.json`                                                                                                                                                                                                          |
| `DeadCode`            | `knip` — bundled `config/knip.json`                                                                                                                                                                                                                   | any unused file/export/dep, unlisted import                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `Commits`             | `commitlint origin/main..HEAD` — bundled config                                                                                                                                                                                                       | any non-Conventional-Commit (no base branch → warn)                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `CodeRabbit`          | `coderabbit review --agent` — your uncommitted edits, or with a clean tree the committed branch diff against `origin/main` (CodeRabbit CLI, installed per machine; in CI the GitHub App reviews and review-thread resolution gates the merge)         | any finding without a complete waiver in `.repo-contract/exceptions/coderabbit.json` (CI / no CLI / detached `HEAD` → warn, always recorded)                                                                                                                                                                                                                                                                                                                                                     |
| `Mutation`            | Stryker, zero-tolerance (`isolated`)                                                                                                                                                                                                                  | any Survived/NoCoverage/Timeout mutant (always runs: without a `stryker.config.*` the bundled baseline does; mutants hidden by `Stryker disable` comments are counted in the rationale)                                                                                                                                                                                                                                                                                                          |

\* runs the consumer's own npm script; **skipped with a note** if absent.

**A genuinely brand-new package** (nothing but `package.json` — no `src/`,
`tsconfig.json`, `eslint.config.*`, `build` script, or `.git` yet) will see
more than `ApiDocs`/`Schema`/`Size` behave this way on the very first
`npm run contract`: `Lint`, `Typecheck`, `Build`, `Architecture`, `GitHygiene`,
and `Coverage` **fail outright**, each naming exactly what's missing (a
`tsconfig.json`, a `src/` directory, a `git init`, …) — this is deliberate,
not a bug: unlike the `config/`-backed checks, the `eslint`/`tsconfig`
baselines are meant to be **extended** by the consumer's own config (see
"Overriding a bundled config" below), never silently substituted, so `Lint`/
`Typecheck` enforce real rules against real consumer config from day one
instead of quietly no-op'ing; `Mutation` is the same (it always runs, and fails until there is
something to mutate). `Accessibility` (no built docs site yet) and `BranchProtection` (no
`.git`/GitHub remote yet) cannot run at all there, so they record a degradation instead: a warn
locally, accepted by a record in `.repo-contract/exceptions/environment.json`, and a failure under
the CI gate without one (see "Exceptions" below). Run `git init`
and add a `tsconfig.json` / `eslint.config.mjs` (extending this package's
own) and a `src/` tree to bring the rest green — Step 2 of adoption, not
Step 1.

### Not cloned from `repo-contract.config.ts`

`security-network`, `adr-governance`, and the
`test-unit/integration/property/e2e` split — each encodes repo-contract's own
design rather than a general package standard. (`api-contract` used to be on
this list; it moved here entirely once every repo in the fleet versioned via
Changesets — see `contract.ts`'s own doc comment.)

## Contributor setup: Socket.dev

`SecuritySocket` scores the package on Socket.dev and never passes silently when it cannot run: it **fails** in CI and for a
rejected token, network or rate limit, and **warns** on a developer machine that has no API key.
Either way it prints the exact steps for where it is running -- the short version:

- **On your machine:** `npm install --global @socketsecurity/cli`, then `socket login`; confirm
  with `socket config list` that `apiToken` is set.
- **In GitHub Actions:** create a Socket API token (socket.dev > Settings > API Tokens, permission
  `packages:list`), add it as the repository (or organization) secret `SOCKET_SECURITY_API_KEY`, and
  map it under `env:` on the step that runs the contract (the scaffolded `contract.yml` does).

`SOCKET_SECURITY_API_KEY` is read only by the `socket` CLI while the contract runs; shipped code never
reads it.

Each scan spends Socket API quota (see your token's limits in the Socket dashboard), so it is spent sparingly:

- **It runs last.** `internal-package-contract` runs every check except `SecuritySocket` first and
  scans only if all of them passed; a change that is already failing prints
  `[SKIPPED] SecuritySocket` and costs nothing.
- **It is cached.** Socket scores a _published_ version, so the result depends only on
  `<package>@<version>`, not on the branch or pull request. A successful score is kept for 24 hours
  and served to every run, every pull request and the pre-push hook. Failures are never cached.
  `IPC_SOCKET_CACHE_DIR` moves the cache, `IPC_SOCKET_CACHE_TTL_HOURS` changes the lifetime, and
  `IPC_SOCKET_CACHE=off` disables it. The cache is local to a machine: CI deliberately does not
  persist it with `actions/cache`, because a cache written by a workflow that runs pull-request
  code can be poisoned (CodeQL `actions/cache-poisoning`), and the scaffolded workflows use no
  caches at all for the same reason.

## Bootstrap order

IPC has a deliberate dev-time cycle with `repo-contract`. IPC depends on the _published_
`repo-contract` (`~0.8.8`) at runtime: every check is a `repo-contract` check. `repo-contract`, in turn,
declares IPC as a _development_ dependency (`github:MaverickCER/internal-package-contract#<tag>`) and
consumes its API-contract engine and benchmark kit. It works because `repo-contract`'s own
self-contract runs against its freshly built `dist/` while IPC resolves the published package, so
neither ever needs the other's unreleased code.

The upgrade order for a breaking `repo-contract` change follows from that:

1. publish the new `repo-contract`;
2. bump IPC's `repo-contract` dependency and release IPC (a new tag);
3. re-pin `repo-contract`'s own IPC devDependency to that tag.

The full rationale is [`repo-contract` ADR 0018](https://github.com/MaverickCER/repo-contract/blob/main/specs/decisions/0018-ecosystem-bootstrap-cycle-and-package-names.md).

## Dependency overrides every consumer needs

`npm` honors `overrides` only from the **root** project, so a fix made here does not reach a package
that depends on this one. `GithubActions` is run through `github-actionlint`, which unzips the
actionlint release at install time with `adm-zip@^0.5`; every `adm-zip` before 0.6.1 carries
published advisories (decompression bombs, SUID/SGID and symlink extraction). Add this to your own
`package.json` (the `init` scaffold already does):

```json
{ "overrides": { "adm-zip": "0.6.1" } }
```

## Overriding a bundled config

Write your own — the check picks it up automatically. Extend the bundled one so
the baseline still evolves centrally:

```js
// .dependency-cruiser.cjs
const base = require("internal-package-contract/config/dependency-cruiser")
module.exports = { ...base, forbidden: [...base.forbidden /* yours */] }
```

Available: `./config/dependency-cruiser`, `./config/knip`, `./config/stryker`,
`./config/commitlint`, `./config/secretlint`, `./config/markdownlint`, plus the
`./eslint`, `./prettier`, `./tsconfig` baselines (extend, never copy). The
`tsconfig` baseline is the strictest practical configuration.

The thresholds `COVERAGE_THRESHOLDS`, `CRAP_THRESHOLD` / `MAX_COMPLEXITY` live
in [`checks/`](checks/) — raise them there when the whole fleet is ready,
never per-consumer. `Mutation` has no threshold to raise: it requires zero
Survived/NoCoverage/Timeout mutants, matching repo-contract's own policy.

## Stability: what a release promises

This package is internal and is consumed at a pinned release, but it is the standard the other
packages are held to, so changing it is a versioned event. A release's version tells you whether a
consumer's `npm run contract` can start failing:

- **patch** -- a fix that makes a check more correct for a package that already satisfies the standard;
- **minor** -- a new check or a stricter rule (a consumer may need changes to pass it), a new export,
  flag or subcommand; below 1.0.0 a stricter rule is a patch-level bump, as for any 0.x package;
- **major** -- removing or renaming a check id, a subcommand, a flag or an export; changing the shape
  of an exception record, the report in `reports/contract/`, or the check ids a consumer's exception
  records are keyed to.

The promised surface is exactly: the check ids in [`contract.ts`](contract.ts); the `internal-package-contract`
subcommands and flags (`init`, `exceptions`, `sync-benchmark-guides`, `update-baseline`, `--checks`,
`--only`, `--skip`, `--strict`); the `./checks/*` (including `./checks/parts`), `./logs`, `./config/*`, `./eslint`, `./prettier`, `./tsconfig`
and `./benchmark` exports; the exception-record format ([EXCEPTIONS.md](EXCEPTIONS.md)); and the
`evidence.json` / `report.json` written by every run. The `check-*.mjs` evidence scripts' output envelopes are promised; everything else under `scripts/` that is
not named above is exported for reuse but is an implementation detail. A test pins the check ids, so changing them is never accidental.

There is no documentation website: this package is not published and has no end users, so its
README, [EXCEPTIONS.md](EXCEPTIONS.md) and the guides in `template/` are its documentation. The site
requirement in the standard applies to the packages that ship to users, which scaffold one.

## Exceptions

Where a package has a good reason to break a rule, the reason is a committed record in
`.repo-contract/exceptions/` that the owning check reads back every run -- never a comment or a flag.
[EXCEPTIONS.md](EXCEPTIONS.md) documents the record, every registry, how a check that _could not run_
is handled, and `internal-package-contract exceptions`, which lists what is in force.

## env-cap and data-cap, carried by this package

`env-cap` (what a package needs from its environment) and `data-cap` (what data it handles) are dependencies of
this package, and every entry point is handed on, so a package that uses this one installs neither and lists
neither in its own `package.json`:

| Instead of                   | Import                                                                                                                             |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `@maverickcer/env-cap`       | `internal-package-contract/env-cap`                                                                                                |
| `@maverickcer/env-cap/build` | `internal-package-contract/env-cap/build` (also `/node`, `/evidence`, `/helpers`)                                                  |
| `data-cap`                   | `internal-package-contract/data-cap`                                                                                               |
| `data-cap/build`             | `internal-package-contract/data-cap/build` (also `/runtime`, `/runtime/cache`, `/runtime/retry`, `/node`, `/evidence`, `/helpers`) |

Each is the very module the package ships, not a copy. This package is a development dependency, so they are for
code that never ships: build scripts, schema files that env-cap and data-cap only read, and tooling. Code that
runs in production still depends on the library itself.

### Documenting the environment

`internal-package-contract env` documents the credentials and settings a package depends on, and writes
`docs/ENVIRONMENT.md` (formatted with the package's own Prettier settings, and rewritten only when something other
than its timestamp changed). What the standard itself reads, the credentials its workflows use (`PIN_SYNC_TOKEN`,
`SOCKET_SECURITY_API_KEY`) and its tool settings, is described once, in this package's own `ci/env.schema.ts`, which
it ships and declares under `envCap` in its `package.json`; env-cap's cross-package discovery includes it in every
package's document, so a package never writes it again and the explanation cannot drift. A package's own
`ci/env.schema.ts` holds only what is particular to it, and may be left empty or deleted. The scaffold adds the
`docs:env` script and a weekly workflow, `env-rotation.yml` (kept current by `sync`), that opens one issue when a
credential you gave an `expiresAt` is about to expire and closes it again once nothing is due. A package that wants
an expiry date or an owner for one of the standard's credentials names the variable again in its own file with only
that; env-cap fills everything the package leaves unset from the standard's declaration, so nothing else is repeated
(this needs an env-cap that merges the declarations, which the standard's dependency on it must be raised to).

**Nothing in it is required.** Every variable has a default, the contract is read and never executed, no
manifest is generated (so nothing ships and no development dependency is imported at runtime), and the
`EnvContract` check warns at most: a credential expiring or expired, or `docs/ENVIRONMENT.md` out of date. A
package with no `ci/env.schema.ts` of its own passes. A missing Socket key is a warning in CI too: the scan did not run, and
the warning says how to add the key. `internal-package-contract env --check` exits 1 when the document is out of
date, for a script that wants to gate on it.

## Customizing a check

Every check is two halves that can be taken apart: the **evidence** (the command, its working directory,
environment, timeout and output format) and the **policy** (what that evidence has to show). Take the
standard apart, replace the half you need, put it back:

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

Only the `check-*.mjs` evidence scripts are exported, as source files, not wrapped: they are development tools,
never part of what a package ships, and their output envelopes are part of the promised surface. The libraries
behind them are internal. The shared runtime modules and the check factories are exported too. Everything exported is
benchmarked (`npm run benchmark`, results in [benchmarks/](benchmarks)); the entry shells themselves are a few lines
that call the benchmarked library and print its result, so their cost is the library's plus a Node start-up.

## Running a subset

```sh
npx internal-package-contract --checks Format,Lint,Typecheck,Tests
npx internal-package-contract --checks Mutation
npx internal-package-contract --skip Coverage,Crap,Mutation   # everything but the slow analyses
```

```sh
npx internal-package-contract --changed           # only the checks that can be affected by what changed since the default branch
npx internal-package-contract --json              # one machine-readable report on stdout (for editors and scripts)
npx internal-package-contract --logs all          # keep each check's full output in reports/contract/logs/<Check>.log (all, failing (default) or off)
```

The mode can also be set with `IPC_LOGS` or `"internal-package-contract": { "logs": ... }` in package.json (a flag wins over the
environment, which wins over the package). A log file is created as soon as a check's evidence is available and, when the verdict is known, the
verdict is prepended to the top of the file, so the part that matters is the first thing you see.
Progress is streamed as each check finishes.

The logs are written by two hooks that ship with `repo-contract` and are re-exported here, so a package that runs
the contract itself does not install `repo-contract` just to get them:

```ts
import { runRepoContract } from "repo-contract"
import {
  onEvidenceSaveToRepoContractLogs,
  onVerdictPrependRepoContractLogs,
} from "internal-package-contract/logs"

await runRepoContract(config, {
  onEvidence: onEvidenceSaveToRepoContractLogs(), // the raw output, the moment a check's evidence exists
  onVerdict: onVerdictPrependRepoContractLogs(), // the verdict, at the top of the same file, the moment its policy returns
})
```

Both take the same options (`cwd`, `directory`, `mode`, `onProblem`). Writes happen in the background in order;
`await repoContractLogs(options).flush()` before reading the logs or ending the process.

## CI

`init` writes [`.github/workflows/contract.yml`](template/contract.yml) — `npm ci`
then `npm run contract`, with `fetch-depth: 0` so `Commits` has the base branch.

## Release

`init` also writes [`.github/workflows/release.yml`](template/release.yml) — a thin
caller that invokes this package's own
[`release-npm-changesets.yml`](.github/workflows/release-npm-changesets.yml) reusable
workflow (Changesets + npm OIDC trusted publishing, matching every current
consumer's own `RELEASING.md`). The real logic lives in that one reusable workflow,
not the caller: a fix or improvement there (a `changesets/action` version bump, a new
publish flag) reaches every consumer's next push to `main` with zero per-repo edits,
the same reason checks live in `checks/` rather than each consumer's own config.
Requires the consumer to already have Changesets set up (`npm run version` /
`npm run release` scripts, `.changeset/config.json`) and its own npm trusted
publisher registered on npmjs.com — `init` does not set either of those up. Pass
`roll-floating-major-tag: false` in the caller's `with:` (see the reusable
workflow's own input doc comment) for an npm-only consumer with no composite GitHub
Action to version.

A consumer whose `typedoc.json` makes it an `ApiContract` target also needs a thin
caller of [`api-baseline-sync.yml`](.github/workflows/api-baseline-sync.yml) (`on:
pull_request`, gated on `github.head_ref == 'changeset-release/main'`), so the
committed baseline tracks each release's real version instead of falling one release
behind on the very next PR.

## Benchmarks

[`scripts/benchmark/kit/`](scripts/benchmark/kit) is the one self-contained way every package here
benchmarks itself. A package supplies an **input** -- a `suite.mjs` that imports its real functions and
documents each one -- and the kit stresses it through a ladder of doubling sizes (ten by default, each
suite may declare its own), measures wall time, CPU time and memory, infers the big-O and compares it
with the documented one, prices the result, and writes an **output**: `results.json` (a fixed,
validated shape, schema version 4) and a cost-first `BENCHMARKS.md`.

- **Three views:** end-to-end total impact (empty functions, with vs without the package), every
  function on its own, and what makes up one operation (nested calls counted once).
- **Import and run:** `import { defineSuite } from "internal-package-contract/benchmark"`; list functions as
  `{ call, input }` and the kit calls `call(...input(n))` at every size. `defineSuite` rejects
  undocumented entries (why, what poor performance means, big-O and its reason, every variable).
- **Commands:** `run-suite.mjs <suite> [--quick] [--check] [--render] [--only ...]`.
- **`init`** scaffolds `benchmarks/README.md` (input and output shapes), `WRITING-BENCHMARKS.md` and
  `READING-BENCHMARKS.md`, plus a working `suite.mjs` and the `benchmark` scripts with `--name`. The
  two guides are canonical here; the `BenchmarkGuides` check fails a package whose copy differs, and
  `internal-package-contract sync-benchmark-guides` rewrites them.

### What is measured, and what may fail a pull request

Numbers from different runners, on different days, are not comparable, so a raw millisecond delta
against another run is shown and never judged. What can fail a run is limited to properties of one run and
ratios between quantities measured in the same run, which survive a change of machine
([`scripts/benchmark/gates.mjs`](scripts/benchmark/gates.mjs)):

1. a function whose **measured growth class differs** from its documented big-O (the exponent is
   fitted on the largest sizes, with an R² floor, so a fixed per-call cost does not read as
   sub-linear growth);
2. the package's **overhead relative to its own bare baseline** growing past an allowance (50% for
   millisecond-scale work, 70% for microsecond-scale work) against the last run on `main` _and_ the last
   release. A package tunes these with a `GATES` export in its `benchmarks/budgets.mjs`.

A function whose big-O **cannot be determined** (too few usable sizes, no difference between them, or timings that follow no one growth rate) is a
warning, and the warning says which and why in the pull-request comment and in the `BenchmarkComplexity` check, never a failure: nothing is known to
be wrong, but nothing is checked either. There is no threshold on a raw time anywhere.

### Every input of every public function

A public function with more than one input, several parameters or an object with several keys, has several
things that can change its cost. The `BenchmarkCoverage` check reads the committed API baselines
(`.repo-contract/api-contract`) and fails until each such function is benchmarked and each of its parameters and
keys is accounted for in the benchmark that exercises it (`covers`): `swept`, `sweep:<variable>` (a second
variable the function scales with, measured on its own with its own big-O), `variant:<name>`, `fixed: <why>` or
`not covered: <why>`. A function that has no benchmark at all is listed under the suite's `notBenchmarked`, with
the reason. A function a public object holds (`validators.range`) is checked the same way, and a name that is no
longer a public function is stale and fails too. See `benchmarks/WRITING-BENCHMARKS.md`.

### The workflows

- [`benchmark-pr.yml`](.github/workflows/benchmark-pr.yml) (reusable): on a pull request, build, run
  `npm run benchmark:check` and the benchmarks, render the summary with the gates, post or update the
  comment, and fail the run if a gate failed. Its token can comment and nothing else: it never pushes
  to the pull request. The caller lists suites (one `label|directory|history-file` per line) and names
  `budgets-path`; a caller pins the workflow by commit SHA.
- [`benchmark-record.yml`](.github/workflows/benchmark-record.yml) (reusable): after a merge, measure
  the merge commit and open a small pull request recording `results.json`, `BENCHMARKS.md` and a history
  entry that names the **merge commit**, its **pull request** and the **package version**; CI is
  dispatched on it and it merges when green.

### History, summaries and the page

[`scripts/benchmark/`](scripts/benchmark) holds the consumer-agnostic scripts that turn results into
history, a summary and a page:

- **`append-history.mjs <results.json> <history.json> [--commit <sha>] [--pr <n>]`** appends a compact
  entry (each tier's `inputs`, `medianMs` and `unitsPerSecond`, the `versions` copied from the results).
- **`classify-complexity.mjs`** infers the growth class of a group from its tiers.
- **`complexity-gain.mjs`** finds every group whose class got worse than at the last release and matches it against the exception registry; the `BenchmarkComplexity` check and the pull-request gate both use it, so a regression is stopped in the pull request and again before a release unless a human recorded why it is acceptable.
- **`render-summary.mjs`** renders the pull-request comment: gate results first, then complexity shifts
  since the last history entry, then one table with each function, the variable it varies, its big-O and whether that is the same, worse or improved since the last run (or N/A, with the reason, when either run could not determine it). A function that depends on more than one variable lists each under `sweeps` and gets one row, and one growth class, per variable.
- **`render-page.mjs`** builds `docs/benchmarks/index.html` fresh on each deploy (never committed): one
  chart per group with its inferred class and fit, every figure also as a table that links the commit,
  pull request and version of each run. It needs no script and meets the same WCAG 2.2 AA bar as the
  rest of a package's site.

A consumer wires the three scripts as thin npm scripts that forward to this package's copies:

```json
{
  "scripts": {
    "benchmark:history": "node node_modules/internal-package-contract/scripts/benchmark/append-history.mjs",
    "benchmark:summary": "node node_modules/internal-package-contract/scripts/benchmark/render-summary.mjs",
    "benchmark:page": "node node_modules/internal-package-contract/scripts/benchmark/render-page.mjs"
  }
}
```

A package also defines `docs:benchmarks`: the `render-page.mjs` command with its own `--out docs/benchmarks/index.html`,
`--readme` and one `--history "<label>|<file>"` per history file. The docs link to that page and it is never
committed, so `internal-package-contract` runs `npm run docs:benchmarks` before the checks whenever the package
defines it. A link check on a clean checkout, on a laptop and in CI therefore behaves the same, and a workflow does
not need its own copy of the command.

## Landing page

A package's landing page is written as content and generated, so every MaverickCER package meets one
bar: it leads with the outcome for an organization, states each guarantee with its scope, shows real
output, says who should not adopt it, and ships a one-page `brief.html` a developer can hand to a
manager.

1. Write `docs/site.json` (hero outcome, problem, model, demo, scoped guarantees, comparison, adoption,
   `notFor`, manager brief, resources). The validator names every missing or weak field.
2. Run `npx internal-package-contract site` to write `docs/index.html`, `brief.html`, `styles.css` and
   `script.js`. `--check` reports stale output without writing; `--content` and `--out` override the
   paths.
3. The `LandingPage` check fails if the content is invalid or the committed pages differ from what it
   produces, so the pages cannot drift from the content. `Accessibility` scans the result.

What the validator enforces is mechanical (required sections, a stated scope on each guarantee, a
`notFor` entry, a brief with its risks). Whether the copy is true and persuasive stays a human review.

## Generated regions, prompts and decision records

Some facts a document states are derivable, so a person should not retype them. A document marks such a fact
as a generated region, and `internal-package-contract generate` writes it:

```md
<!-- ipc:begin entry-points -->
<!-- ipc:end entry-points -->
```

The `entry-points` region is the package's public API map: one row per entry point `package.json` exports, with
the export, the source folder, the runtime constraint, the stability tier and the purpose. The export names and
the number of rows come from `exports`; the rest is what only a person can say, kept once in `docs/surface.json`
instead of in every document that lists the entry points:

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

`generate` rewrites only what is between the markers, formats it with the package's own Prettier settings, and
changes nothing on a second run. `generate --check` writes nothing; the `GeneratedRegions` check runs it, and
fails on a stale region, on markers that are missing, repeated or out of order, and on a source that omits an
exported entry point or lists one that is not exported. Only the fixed list of documents in
`scripts/generate/documents.mjs` is read. `add export <name>` adds the new entry point to `docs/surface.json` as
`Experimental`, with a `TODO:` purpose.

A scaffold asks for what only its author knows with a single-line comment, `<!-- ipc:prompt: ... -->` (or a
`TODO:` value in `docs/surface.json`). Answering means replacing the whole comment. The `PromptBlocks` check
warns while any is left and fails when a release is being verified: the release workflow runs it with
`IPC_RELEASE=1` before it packs the tarball. It checks that a question is gone, never that the answer is good.

`internal-package-contract new adr "<title>"` starts a decision record in `specs/decisions` (or
`docs/decisions`, `docs/adr`) with the next number and the sections every record has, each with its prompt.

## Optional checks

A check that not every package needs is off until the package names it. `internal-package-contract add check
AmbientCapabilities` writes the name under `"internal-package-contract"."checks"` in `package.json`, with the
settings the check reads written out beside it; `init` never turns one on.

`AmbientCapabilities` reads the tarball npm would publish and fails if a shipped file reaches the filesystem
(`node:fs`), starts a process (`node:child_process`) or reads `process.env` itself, or if the package declares a
dependency it must not have. A library that is handed these lets a consumer see, and replace, everything it can
do, and a supply-chain scanner flags every package that reaches them itself. Each capability lists the entry
points that may use it (`"bin"`, or an export such as `"./node"`), derived from `package.json` and never from a
glob. A capability that is not listed is not checked.

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

It is a textual defense in depth, not a proof: it catches a literal reintroduction and cannot show that no evasion
exists. `internal-package-contract tool ambient` gives the same answer to a build step or a CI job without running
the contract. A package with its own contract file (as `repo-contract` has) imports `ambientCapabilitiesCheck`
from `internal-package-contract/checks/ambient-capabilities` and declares it after its tests.

## Agent skills

An AI agent that is handed a package's link should learn how to use it without loading the whole repository.
`internal-package-contract skill` writes `skills/<name>/SKILL.md`, a manual short enough to load every time
(600 words by default, 1000 at most), and `skills/<name>/references/api.md`, the signatures an agent loads only
when it needs them. `skill --check` reads and writes nothing and fails when what is written is not what would be
written now.

Nearly all of it is read from what the package already says about itself: its name and version from
`package.json`, the import table from `docs/surface.json`, the signatures from the committed API baselines. It
cannot drift, because nobody types it. The few things only the author knows live in `docs/skill.json`:

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

The example is taken from a real file, at most 40 lines, so it is compiled and tested with the package rather than
retyped. `when` is at most 300 characters, because it is what an agent reads to decide whether to load the rest.
The command prints the link to give an agent. `internal-package-contract add check AgentSkill` turns on the
`AgentSkill` check, which fails on a stale or invalid skill or one over its budget. It judges shape and size,
never whether the advice is good, and nothing measures whether a skill makes an agent more accurate: compare an
agent with and without it on your own tasks before relying on it.

## Build and release helpers

The scripts every package used to copy are run from here, from the package's root, as `internal-package-contract
tool <name>`:

- `size`: Fails when an entry point is over its gzip budget. The budgets are the package's own, the default export of `ci/size-budgets.mjs` (a module, so each raise can say why). `--json <file>` also writes the sizes.
- `badges`: Writes the coverage and size badges from their summaries. `"badges": { "sizeEntry": "<label>" }` picks the entry shown.
- `api-report`: Fails when `docs/api-report/` is not what `typedoc.markdown.json` generates.
- `cjs-interop`: Makes `require()` of the built ESLint plugin return the plugin, not `{ default, ...rules }`.
- `compiler-isolation`: Fails when a client entry can reach the bundled TypeScript compiler.
- `ambient`: The `AmbientCapabilities` answer, without the contract.

## Shared files

Files that are the same in every package are carried as managed copies, so there is one to change and a drift
check for the rest: `.editorconfig`, `typedoc.markdown.json`, `benchmarks/budgets.mjs` and the two benchmark
guides, next to the code copies. `sync --add <name>` enrols one and `sync --apply --update` restores it; `init` on
an existing package enrols each one it already carries unchanged. The workflows (`release`, `scorecard`,
`env-rotation`, `sync-internal-package-contract`) are always managed.

## Moving to a new release

`internal-package-contract upgrade vX.Y.Z` does in one command what a new release asks of a package: it installs
the release, re-pins the workflows that call its reusable workflows, brings the managed files up to date
(`sync --apply --update`), regenerates the landing page and copies the benchmark guides. It stops at the first
step that fails and leaves everything as uncommitted changes to review, add a changeset to, and commit. The
reusable `dependency-pin-sync.yml` uses it when the installed release has it. GitHub does not let the default
`GITHUB_TOKEN` push a change to `.github/workflows/*`, so a pin-sync pull request that changes a pinned workflow
needs a token that can: pass one as the `PIN_SYNC_TOKEN` secret (a fine-grained token with "Contents", "Pull
requests" and "Workflows" write access); without it the run falls back to `GITHUB_TOKEN`.

## README layout

A published package's README exists to help a developer decide whether to install and adopt it, so every
package answers the same questions in the same order and sends everything else to its guides. The
`ReadmeStructure` check enforces the layout: **Why it exists**, **How it differs**, **What it does** (with a
`### See it run` showing real output), **Install and verify**, **Fit and capabilities**, **Limits and when
not to use it**, **Security and supply chain**, **Maturity, versioning and support**, **Documentation** and
**Next steps** (Evaluate, Integrate, Verify). The badges above the first section are CI status, npm version,
coverage, mutation, Scorecard, Socket and license, and the README stays within 220 lines. The coverage and mutation badges read JSON the package publishes to its Pages site, and each has a details file beside it (`coverage.json`, `mutation.json`, `size.json`) that repeats the number and says what it is: the coverage headline is the lowest of lines, statements, functions and branches (not their average), shown with all four and what each counts; the mutation score is the share of applicable mutants detected, with the count of each status; the size is a gzip size against its budget. A reviewer never has to guess which measure a number is. The README badges link to those files; `node node_modules/internal-package-contract/scripts/run-mutation-badge.mjs` writes `docs/mutation-badge.json` from the Stryker report, and the `ScorecardWorkflow` check requires the workflow that publishes the Scorecard the badge reads. A section that does not help that
decision belongs in a guide. The scaffold's README already has this shape, with a prompt in each section.
Whether the prose is accurate and persuasive stays a human review; every code block and command in it
should be run as written before release.

## What stands between a change and a release

A release is gated by evidence that already exists, not by a second system. This is where each requirement
lives, so a new check is added only for something no existing one covers.

| Requirement                                                                                                                                       | Enforced by                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Quality gates pass; the branch cannot merge red                                                                                                   | The contract run in CI, `BranchProtection` (required status check, review threads resolved)                                   |
| Public API and CLI/schema/Action surface changes carry the right version bump                                                                     | `ApiContract`, `SurfaceContract`, Changesets (a human merges the release PR)                                                  |
| The package metadata, license and contents are right                                                                                              | `Packaging` (publint), `Licenses`, `GitHygiene`, `DistNoUrls`, `Size`                                                         |
| The published types resolve under every module mode                                                                                               | `TypeResolution` (attw, on the packed tarball)                                                                                |
| **What npm would ship installs and imports for a consumer**                                                                                       | `PackedConsumer`, and the same script run on the exact tarball in the release build job, before it is uploaded for publishing |
| **The declared minimum Node.js is tested**                                                                                                        | `EngineMatrix`                                                                                                                |
| **Workflows and config this package owns have not drifted**                                                                                       | `ManagedFiles`; `internal-package-contract sync` shows the difference and restores files only when told to                    |
| Third-party actions are pinned; pins agree                                                                                                        | `GithubActions`, `PinConsistency`                                                                                             |
| Publishing uses OIDC with no stored token, `id-token` only on the publish job, the pinned npm, and publishes the exact tarball the build job made | `release-npm-changesets.yml`                                                                                                  |
| **Publishing happens only from the default branch**                                                                                               | the `publish` job's `if` in `release-npm-changesets.yml`                                                                      |
| **The registry serves the version, with its provenance attestation**                                                                              | the last step of the `publish` job; a failure turns the run red                                                               |
| The package's own security posture is visible and scored                                                                                          | `SecurityDeps`, `SecuritySocket`, `ScorecardWorkflow`, `CodeScanning`                                                         |
| The README answers whether to adopt it                                                                                                            | `ReadmeStructure`                                                                                                             |

The bold rows were added after auditing a proposal list against this table. Two proposals were not adopted
as asked: a single "release readiness" verdict would only repeat the contract's own report, which already
names every failing check, and a managed-file list covering the whole scaffold would report drift in files a
package is meant to change (its README, sources and docs). `init` stays non-destructive, `sync` is a
separate act from checking, and nothing is rewritten on install. The managed list is deliberately short:
the release workflow, the pin-sync workflow and the Changesets config, compared on what they mean.

## Describing a change once

A pull request needs a description of what it changes, and a package already holds the evidence for most of it.
`internal-package-contract report` reads that evidence and writes the account as Markdown to paste into the
pull request, so it is not documented a second time by hand: what changed by area (source, tests, benchmarks,
documents, exceptions, workflows), what it means for a release (each new changeset, with the bump and its summary),
the decision records it adds, the exceptions it records or retires with the first sentence of their reasons, the
dependencies it moves, and what each check said in the last contract run (tests, coverage, mutation, API and surface
contracts, benchmark coverage and growth). It ends with what no local run can see (CodeRabbit's review, GitHub's own settings,
the benchmark job, the CI jobs the contract does not run), so none of those is assumed to have passed. Nothing in it is
written by hand and every line comes from a source a reader can open; the prose a person still writes is the changeset
summary and the decision records, which stay next to the code they describe.

`report --base <ref>` measures against another ref (default `origin/main`, else `main`), and `--out <file>` writes
it to a file. Run the contract first, or the report says that it has not been run.

## Changing the standard without breaking what depends on it

Three packages run this contract, so a change here is only as good as the last time someone ran it against them.
`internal-package-contract verify-consumers <checkout>...` does that mechanically. For each checkout of a package that
depends on this standard it runs the contract's fast, offline checks twice in throwaway copies, once with the version
of the standard the package has installed and once with this one, and names every check that got worse. A check that
fails both ways was already failing and is not blamed on the change; the checkout itself is never touched. The leftover
checks (the network and service checks, coverage, CRAP and mutation) are not run, since they either say the same thing
whatever the standard does or are run by CI anyway; `--skip a,b` leaves out more and `--keep` keeps the copies.

It also says where an install would add its own copy of a package the standard depends on, because the checkout has
none or an incompatible one: that is a version difference an upgrade would surface, and the kind that makes two copies of
a lint plugin load at once. It is run on demand today. Running it on every pull request needs a token that can read the
three repositories and this one, which is a decision for the maintainer, not something a workflow can assume.

Mutation testing is the longest part of this repository's own contract. The check always runs every mutant, whatever a
package's own `incremental` setting or file says: a result carried over from a run made under other conditions (a loaded
machine whose tests timed out and so counted as kills, a different concurrency) can pass a gate that a cold run in CI
would fail, as one did here. A run over inputs that have not changed in
any way is not run a second time: when a clean run was kept for the same hash of every file git does not ignore, and
of the Node.js version, its evidence is put back and the `Mutation` check judges it exactly as it would a fresh one.
Anything that changes any input, including a file the tests only read, runs the whole thing. While writing, `internal-package-contract mutation`
mutation-tests only what a change touched (and the sources its changed tests import), with every mutant of those files and
the package's own concurrency; it is a fast loop and says so, since a test in a file nobody touched can kill a mutant in
one that was, and only the full check can say a change is finished. It never applies under CI,
and `IPC_MUTATION_MEMO=0` runs the mutation testing regardless. What it cannot see: files git ignores that are not derived
from the ones it does, and installed packages beyond what the lockfile pins. Only a run in which every mutant was caught or
left out is kept, so a result produced while the machine was struggling is never replayed.

A mutant that times out is not always one that loops: on a machine that is swapping, whichever mutant happened to be running
when it stalled is reported as a timeout, a different one each run and none of them when run alone. Before a timeout counts,
that mutant is run again alone (at most five are); one that is caught the second time is recorded as caught, with the reason
in the evidence, and one that times out again stays a failure.

## Evolving the standard

Per ADR 0010: a review finding becomes a new check here only when it exposes a
**repeatable error class** that materially affects packages and can be
mechanically detected. One-off fixes stay in the package that found them.
