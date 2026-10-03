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

```sh
npm i -D internal-package-contract typescript @types/node vitest @vitest/coverage-v8
npx internal-package-contract init    # scaffold repo files + wire git hooks
npm run contract
```

(`internal-package-contract` itself is a `file:../internal-package-contract`
or a git range such as `github:MaverickCER/internal-package-contract#v0.8.1`,
per "Not published to npm" above; pin a tag or commit rather than `#main`. The
other four are ordinary registry devDependencies every TypeScript + Vitest
package already needs.)

`init` is non-destructive (`--force` to overwrite). Run with no flags it
retrofits an existing package; with `--name <pkg> [--owner <org>]
[--description <text>]` it scaffolds a complete new package from
[`template/package/`](template/package) first (`package.json`, `src/`, tests,
the `tsup`/`tsconfig`/`eslint`/`prettier`/`knip`/`stryker`/`typedoc`/`vitest`
configs, governance docs, GitHub templates and workflows, and the `overrides`
entry described under "Dependency overrides every consumer needs"). It:

- writes `.gitignore`, `.gitattributes`, `.editorconfig`, `.gitmessage`,
  `.nvmrc`, `.github/workflows/contract.yml`,
  `.github/workflows/release.yml`, `CODEOWNERS`, `SECURITY.md`,
  `CONTRIBUTING.md`, `benchmarks/README.md`, `WRITING-BENCHMARKS.md` and
  `READING-BENCHMARKS.md` (only the ones you're missing);
- sets `package.json` `scripts.contract`;
- sets `git config core.hooksPath` → the bundled hooks and
  `commit.template` → `.gitmessage`;
- idempotently configures a GitHub ruleset on the default branch (via the
  `gh` CLI, best-effort -- skipped with a warning if `gh` isn't
  installed/authenticated) blocking deletion, blocking force-pushes, and
  requiring every merge to go through a pull request, requiring the
  `contract` status check (strict), and requiring review threads to be
  resolved.

There's no programmatic import of this package -- `contract.ts` ships as raw
TypeScript (Node refuses to type-strip `.ts` under `node_modules`, so a plain
`import("internal-package-contract")` doesn't work), and nothing in this
fleet needs one. The `internal-package-contract` CLI (which loads
`contract.ts` internally via `tsx`) is the one supported way to run it; use
`./eslint`, `./prettier`, `./tsconfig`, and `./config/*` for the individual
tool configs.

**Bundled git hooks** (a local convenience: CI runs the same contract and is the
gate, so a hook that is skipped locally is still caught before merge):

| Hook         | Runs                                                                 |
| ------------ | -------------------------------------------------------------------- |
| `pre-commit` | `Format`, `Lint`                                                     |
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

| Check              | How                                                                                                                                                                                                                                           | Blocks on                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ApiContract`      | diffs every target's public API against its committed baseline (needs `dist/.dts/`)                                                                                                                                                           | the branch's changesets declaring a smaller bump than the diff actually requires                                                                                                                                                                                                                                                                                                                     |
| `Typecheck`        | `tsc --noEmit -p tsconfig.json`                                                                                                                                                                                                               | any type error                                                                                                                                                                                                                                                                                                                                                                                       |
| `Tests`            | `vitest run` **with** V8 coverage, once                                                                                                                                                                                                       | any failing / errored test                                                                                                                                                                                                                                                                                                                                                                           |
| `Architecture`     | `depcruise src` — bundled `config/dependency-cruiser.cjs`                                                                                                                                                                                     | any error-severity violation (circular deps, etc.)                                                                                                                                                                                                                                                                                                                                                   |
| `GithubActions`    | `github-actionlint` (npm wrapper for actionlint)                                                                                                                                                                                              | any workflow finding (no workflows → pass)                                                                                                                                                                                                                                                                                                                                                           |
| `GitHygiene`       | tracked build output, conflict markers, `.gitignore` gaps, `package.json` `files`                                                                                                                                                             | a repo-maintenance defect                                                                                                                                                                                                                                                                                                                                                                            |
| `BranchProtection` | `gh api` against the default branch's GitHub ruleset                                                                                                                                                                                          | deletion / force-push / PR-required protection, the `contract` required status check (strict), or required review-thread resolution missing (`gh` unavailable is a recorded degradation)                                                                                                                                                                                                             |
| `Coverage`         | reads `Tests`' summary vs. `COVERAGE_THRESHOLDS`                                                                                                                                                                                              | any metric below threshold                                                                                                                                                                                                                                                                                                                                                                           |
| `Crap`             | `crap4ts src` — CRAP and cyclomatic ceilings (`CRAP_THRESHOLD` / `MAX_COMPLEXITY`; `dependsOn Coverage`)                                                                                                                                      | any function over either ceiling                                                                                                                                                                                                                                                                                                                                                                     |
| `Size`             | `npm run size` \*                                                                                                                                                                                                                             | the consumer's size script failing                                                                                                                                                                                                                                                                                                                                                                   |
| `NoMinify`         | static check of tsup config / scripts + inspection of `dist/` for minified code                                                                                                                                                               | any `minify*` option, or a minified-looking built file (Socket flags minified code; 0 minification is allowed; no allowlist)                                                                                                                                                                                                                                                                         |
| `DistNoUrls`       | `repo-contract/presets` `distNoUrls` scanner over **every** file in `dist/` (maps, `.d.ts` too)                                                                                                                                               | any shipped URL without a complete record in `.repo-contract/exceptions/dist-urls.json` (stubs scaffolded; stale records fail)                                                                                                                                                                                                                                                                       |
| `Duplication`      | `jscpd src`                                                                                                                                                                                                                                   | duplication above the budget in `checks/duplication.ts`                                                                                                                                                                                                                                                                                                                                              |
| `Packaging`        | `publint`                                                                                                                                                                                                                                     | any packaging **error** (warnings warn)                                                                                                                                                                                                                                                                                                                                                              |
| `TypeResolution`   | `attw` on the packed tarball (`./schema` excluded)                                                                                                                                                                                            | any packaged type-resolution problem                                                                                                                                                                                                                                                                                                                                                                 |
| `Licenses`         | `licensee --production --osi`                                                                                                                                                                                                                 | any shipped dep without an OSI license                                                                                                                                                                                                                                                                                                                                                               |
| `DocsMarkdown`     | `markdownlint-cli2` — bundled `config/markdownlint.jsonc`                                                                                                                                                                                     | any markdown issue                                                                                                                                                                                                                                                                                                                                                                                   |
| `DocsLinks`        | `linkinator`, recursive: Markdown crawl from `README.md` + HTML crawl over `docs/`                                                                                                                                                            | any broken **local** link (external rot warns)                                                                                                                                                                                                                                                                                                                                                       |
| `DocsFragments`    | bundled `scripts/check-docs-fragments.mjs`                                                                                                                                                                                                    | a `filename.md#fragment` link whose fragment isn't a real heading (a gap neither `DocsMarkdown` nor `DocsLinks` covers)                                                                                                                                                                                                                                                                              |
| `BenchmarkGuides`  | compares `benchmarks/WRITING-BENCHMARKS.md` and `READING-BENCHMARKS.md` with the canonical copies in `template/benchmarks/`                                                                                                                   | a copy that differs or is missing (`internal-package-contract sync-benchmark-guides` fixes it)                                                                                                                                                                                                                                                                                                       |
| `Accessibility`    | `pa11y` (WCAG2AA) against the consumer's own built docs site                                                                                                                                                                                  | any accessibility violation (no built site to scan → warn)                                                                                                                                                                                                                                                                                                                                           |
| `SecurityDeps`     | `npm audit --omit=dev` (what users install)                                                                                                                                                                                                   | any critical advisory (never waivable); any lower one without a complete exception record                                                                                                                                                                                                                                                                                                            |
| `SecurityDevDeps`  | `npm audit` over the whole tree, minus `--omit=dev` (the development and CI tooling)                                                                                                                                                          | a critical advisory in development tooling; lower ones warn                                                                                                                                                                                                                                                                                                                                          |
| `SecuritySecrets`  | `secretlint` — bundled `config/secretlint.config.json`                                                                                                                                                                                        | any detected secret                                                                                                                                                                                                                                                                                                                                                                                  |
| `Suppressions`     | parses every source and Markdown file for suppression comments (ESLint, TypeScript, Stryker, V8/c8/Istanbul coverage, jscpd, Prettier, markdownlint, secretlint); the full list is kept in the evidence                                       | a suppression with no reason where it is written, a blanket one (`@ts-ignore`, `@ts-nocheck`, `eslint-disable` naming no rule), or a stale record — unless a complete record in `.repo-contract/exceptions/suppressions.json` covers it                                                                                                                                                              |
| `SecuritySocket`   | `socket package score` (`@socketsecurity/cli`) — the package's own Socket page, whole transitive closure incl. peers                                                                                                                          | any `critical`/`high` alert is forbidden; every other alert, `supplyChainRisk` included, needs a complete exception record whose `exceptionType` says what is actually true (`validated-false-positive` with a mechanical re-verification, `tooling-limitation`, `accepted-risk`, or `required-for-package-to-exist`). **Fails** — never warns — when Socket can't run, with CI-vs-local setup steps |
| `CodeScanning`     | open GitHub code-scanning alerts for the ref being built (your `gh` login locally; the workflow token in CI, which needs `security-events: read`)                                                                                             | an alert in code that builds, runs or ships must be fixed (no exception); an alert in development-only code (tests, unpublished `scripts/`, docs, `.github/`, configs) is rejected with a standing `policy-rule` record in the committed `.repo-contract/exceptions/code-scanning.json`                                                                                                              |
| `DeadCode`         | `knip` — bundled `config/knip.json`                                                                                                                                                                                                           | any unused file/export/dep, unlisted import                                                                                                                                                                                                                                                                                                                                                          |
| `Commits`          | `commitlint origin/main..HEAD` — bundled config                                                                                                                                                                                               | any non-Conventional-Commit (no base branch → warn)                                                                                                                                                                                                                                                                                                                                                  |
| `CodeRabbit`       | `coderabbit review --agent` — your uncommitted edits, or with a clean tree the committed branch diff against `origin/main` (CodeRabbit CLI, installed per machine; in CI the GitHub App reviews and review-thread resolution gates the merge) | any finding without a complete waiver in `.repo-contract/exceptions/coderabbit.json` (CI / no CLI / detached `HEAD` → warn, always recorded)                                                                                                                                                                                                                                                         |
| `Mutation`         | Stryker, zero-tolerance (`isolated`)                                                                                                                                                                                                          | any Survived/NoCoverage/Timeout mutant (always runs: without a `stryker.config.*` the bundled baseline does; mutants hidden by `Stryker disable` comments are counted in the rationale)                                                                                                                                                                                                              |

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

`SecuritySocket` scores the package on Socket.dev and **fails** (never warns) when it cannot run.
When it fails it prints the exact steps for where it is running -- the short version:

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

The full rationale is [`repo-contract` ADR 0018](https://github.com/MaverickCER/repo-contract/blob/main/specs/decisions/0018-ipc-bootstrap-cycle.md).

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
`--only`, `--skip`, `--strict`); the `./checks/*`, `./config/*`, `./eslint`, `./prettier`, `./tsconfig`
and `./benchmark` exports; the exception-record format ([EXCEPTIONS.md](EXCEPTIONS.md)); and the
`evidence.json` / `report.json` written by every run. Everything under `scripts/` that is not named
above is an implementation detail. A test pins the check ids, so changing them is never accidental.

There is no documentation website: this package is not published and has no end users, so its
README, [EXCEPTIONS.md](EXCEPTIONS.md) and the guides in `template/` are its documentation. The site
requirement in the standard applies to the packages that ship to users, which scaffold one.

## Exceptions

Where a package has a good reason to break a rule, the reason is a committed record in
`.repo-contract/exceptions/` that the owning check reads back every run -- never a comment or a flag.
[EXCEPTIONS.md](EXCEPTIONS.md) documents the record, every registry, how a check that _could not run_
is handled, and `internal-package-contract exceptions`, which lists what is in force.

## Running a subset

```sh
npx internal-package-contract --checks Format,Lint,Typecheck,Tests
npx internal-package-contract --checks Mutation
npx internal-package-contract --skip Coverage,Crap,Mutation   # everything but the slow analyses
```

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
against another run is a highlight only. What can fail a run is limited to properties of one run and
ratios between quantities measured in the same run, which survive a change of machine
([`scripts/benchmark/gates.mjs`](scripts/benchmark/gates.mjs)):

1. a function whose **measured growth class differs** from its documented big-O (the exponent is
   fitted on the largest sizes, with an R² floor, so a fixed per-call cost does not read as
   sub-linear growth);
2. the package's **overhead relative to its own bare baseline** growing past an allowance (50% for
   millisecond-scale work, 70% for microsecond-scale work) against the last run on `main` _and_ the last
   release. A package tunes these with a `GATES` export in its `benchmarks/budgets.mjs`.

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
- **`render-summary.mjs`** renders the pull-request comment: gate results first, then complexity shifts
  since the last history entry, then the per-tier table against each group's budget.
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

## Evolving the standard

Per ADR 0010: a review finding becomes a new check here only when it exposes a
**repeatable error class** that materially affects packages and can be
mechanically detected. One-off fixes stay in the package that found them.
