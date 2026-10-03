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

| Check              | How                                                                                                                  | Blocks on                                                                                                                                                                                                                                                                                               |
| ------------------ | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ApiContract`      | diffs every target's public API against its committed baseline (needs `dist/.dts/`)                                  | the branch's changesets declaring a smaller bump than the diff actually requires                                                                                                                                                                                                                        |
| `Typecheck`        | `tsc --noEmit -p tsconfig.json`                                                                                      | any type error                                                                                                                                                                                                                                                                                          |
| `Tests`            | `vitest run` **with** V8 coverage, once                                                                              | any failing / errored test                                                                                                                                                                                                                                                                              |
| `Architecture`     | `depcruise src` — bundled `config/dependency-cruiser.cjs`                                                            | any error-severity violation (circular deps, etc.)                                                                                                                                                                                                                                                      |
| `GithubActions`    | `github-actionlint` (npm wrapper for actionlint)                                                                     | any workflow finding (no workflows → pass)                                                                                                                                                                                                                                                              |
| `GitHygiene`       | tracked build output, conflict markers, `.gitignore` gaps, `package.json` `files`                                    | a repo-maintenance defect                                                                                                                                                                                                                                                                               |
| `BranchProtection` | `gh api` against the default branch's GitHub ruleset                                                                 | deletion / force-push / PR-required protection missing (warns if `gh` unavailable)                                                                                                                                                                                                                      |
| `Coverage`         | reads `Tests`' summary vs. `COVERAGE_THRESHOLDS`                                                                     | any metric below threshold                                                                                                                                                                                                                                                                              |
| `Crap`             | `crap4ts src` — CRAP and cyclomatic ceilings (`CRAP_THRESHOLD` / `MAX_COMPLEXITY`; `dependsOn Coverage`)             | any function over either ceiling                                                                                                                                                                                                                                                                        |
| `Size`             | `npm run size` \*                                                                                                    | the consumer's size script failing                                                                                                                                                                                                                                                                      |
| `NoMinify`         | static check of tsup config / scripts + inspection of `dist/` for minified code                                      | any `minify*` option, or a minified-looking built file (Socket flags minified code; 0 minification is allowed; no allowlist)                                                                                                                                                                            |
| `DistNoUrls`       | `repo-contract/presets` `distNoUrls` scanner over **every** file in `dist/` (maps, `.d.ts` too)                      | any shipped URL without a complete record in `.repo-contract/exceptions/dist-urls.json` (stubs scaffolded; stale records fail)                                                                                                                                                                          |
| `Duplication`      | `jscpd src`                                                                                                          | duplication above the budget in `checks/duplication.ts`                                                                                                                                                                                                                                                 |
| `Packaging`        | `publint`                                                                                                            | any packaging **error** (warnings warn)                                                                                                                                                                                                                                                                 |
| `TypeResolution`   | `attw` on the packed tarball (`./schema` excluded)                                                                   | any packaged type-resolution problem                                                                                                                                                                                                                                                                    |
| `Licenses`         | `licensee --production --osi`                                                                                        | any shipped dep without an OSI license                                                                                                                                                                                                                                                                  |
| `DocsMarkdown`     | `markdownlint-cli2` — bundled `config/markdownlint.jsonc`                                                            | any markdown issue                                                                                                                                                                                                                                                                                      |
| `DocsLinks`        | `linkinator`, recursive: Markdown crawl from `README.md` + HTML crawl over `docs/`                                   | any broken **local** link (external rot warns)                                                                                                                                                                                                                                                          |
| `DocsFragments`    | bundled `scripts/check-docs-fragments.mjs`                                                                           | a `filename.md#fragment` link whose fragment isn't a real heading (a gap neither `DocsMarkdown` nor `DocsLinks` covers)                                                                                                                                                                                 |
| `Accessibility`    | `pa11y` (WCAG2AA) against the consumer's own built docs site                                                         | any accessibility violation (no built site to scan → warn)                                                                                                                                                                                                                                              |
| `SecurityDeps`     | `npm audit --omit=dev`                                                                                               | any advisory of any severity, including `info` (no severity-tiered waiver; every finding needs a full exception record)                                                                                                                                                                                 |
| `SecuritySecrets`  | `secretlint` — bundled `config/secretlint.config.json`                                                               | any detected secret                                                                                                                                                                                                                                                                                     |
| `SecuritySocket`   | `socket package score` (`@socketsecurity/cli`) — the package's own Socket page, whole transitive closure incl. peers | any `critical`/`high` alert is forbidden; every other alert, `supplyChainRisk` included, needs a fully written exception record (all five fields) whose only accepted `exceptionType` is `required-for-package-to-exist`. **Fails** — never warns — when Socket can't run, with CI-vs-local setup steps |
| `CodeScanning`     | open GitHub code-scanning alerts via your `gh` login — **local only**, a no-op in CI                                 | an alert in code that builds, runs or ships must be fixed (no exception); an alert in development-only code (tests, unpublished `scripts/`, docs, `.github/`, configs) is rejected with a standing, auto-written record in the **git-ignored** `.repo-contract/exceptions/code-scanning.json`           |
| `DeadCode`         | `knip` — bundled `config/knip.json`                                                                                  | any unused file/export/dep, unlisted import                                                                                                                                                                                                                                                             |
| `Commits`          | `commitlint origin/main..HEAD` — bundled config                                                                      | any non-Conventional-Commit (no base branch → warn)                                                                                                                                                                                                                                                     |
| `CodeRabbit`       | `coderabbit review --agent --uncommitted` (CodeRabbit CLI, installed per machine)                                    | any finding without a complete waiver in `.repo-contract/exceptions/coderabbit.json` (CI / no CLI / detached `HEAD` → warn, always recorded)                                                                                                                                                            |
| `Mutation`         | Stryker, zero-tolerance (`isolated`)                                                                                 | any Survived/NoCoverage/Timeout mutant (always runs: without a `stryker.config.*` the bundled baseline does; mutants hidden by `Stryker disable` comments are counted in the rationale)                                                                                                                 |

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

`suppression-governance`, `security-network`, `adr-governance`, and the
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
`repo-contract` (`^0.8.8`) at runtime: every check is a `repo-contract` check. `repo-contract`, in turn,
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

## Benchmark kit: the foundation for meaningful benchmarks

[`scripts/benchmark/kit/`](scripts/benchmark/kit) is the one self-contained way every package here
benchmarks itself. A package supplies an **input** -- a `suite.mjs` that imports its real functions and
documents each one -- and the kit stresses it through a doubling ladder of sizes (each suite declares its own tiers), measures wall
time, CPU time and memory, infers the big-O and compares it with the documented one, prices the result
and writes an **output**: `results.json` (a fixed, validated shape) and a cost-first `BENCHMARKS.md`.

- **Three views:** end-to-end total impact (empty functions, with vs without the package), every function
  on its own, and which functions make up the end-to-end overhead.
- **Import and run:** `import { defineSuite } from "internal-package-contract/benchmark"`; list functions as
  `{ call, input }` and the kit calls `call(...input(n))` at every size. `defineSuite` rejects undocumented
  entries (why, what poor performance means, big-O and its reason, every variable).
- **Commands:** `run-suite.mjs <suite> [--quick] [--check] [--render] [--only ...]`.
- **`init`** scaffolds `benchmarks/README.md` (input and output shapes), `WRITING-BENCHMARKS.md` and
  `READING-BENCHMARKS.md`, plus a working `suite.mjs` and the `benchmark` scripts with `--name`.
- **History and pages** read the same results; the history page links to the package's
  `benchmarks/README.md` (`render-page.mjs --readme <url>`).

## Shared benchmark engine

[`scripts/benchmark/`](scripts/benchmark) is a consumer-agnostic engine for the
"tiered benchmark + committed history + PR-comment summary + Pages history chart"
methodology env-cap and data-cap each independently built (`benchmark/`/`benchmarks/`,
`benchmark-fixtures/scenarios.mjs`, `benchmark-fixtures/budgets.mjs`). It does not
run benchmarks itself — a consumer keeps its own `run-benchmark.mjs`/tier
definitions/budgets, exactly as domain judgment they own — it only takes each run's
`results.json` and turns it into history, a PR summary, and a history page, once,
instead of every consumer maintaining its own near-identical copy.

- **`append-history.mjs <results.json> <history.json>`** — appends a compact entry
  to a committed history file. Schema v2: each tier measurement now carries its full
  `inputs: Record<string, number>` alongside `medianMs` (a v1 entry without `inputs`
  stays valid forever — it's just excluded from complexity classification, never
  force-migrated) plus a generic `unitsPerSecond` throughput figure and a `versions`
  object copied verbatim from `results.json`'s own metadata (no hardcoded
  `envCapVersion`/`dataCapVersion`-style field).
- **`classify-complexity.mjs`** — pure library, no CLI. Infers an algorithmic
  complexity class (`constant` → `exponential-or-worse`) per named benchmark group
  from its tiers' `{ medianMs, inputs }`, via a least-squares log-log slope, snapped
  to the nearest of six fixed classes. Never assumes tier names or count — a tier's
  "size" is always the sum of its own `inputs` object. See the module's own doc
  comment for the full algorithm and its documented limitations (constant vs.
  logarithmic, and linear vs. linearithmic, are both inherently close calls at
  realistic tier ratios).
- **`render-summary.mjs`** — renders the Markdown PR-comment summary: a
  **complexity-shift** section (a group's inferred class changed since the last
  history entry — a shape change, not just a slope change) leads, ahead of the
  ordinary per-tier `maxRegressionPercent` budget table. Highlight-only, same as
  before — nothing here gates a merge.
- **`render-page.mjs`** — builds a static `docs/benchmarks/index.html`: small-multiples
  line charts (one per group, tiers as categorical-colored series, ≤200 most-recent
  entries per history file), each annotated with its currently-inferred complexity
  class. Generated fresh by a consumer's own `deploy` job, never committed — same
  treatment `docs/api/` already gets.

A consumer wires these up as three thin npm scripts that just forward to this
package's copies (no consumer-owned logic beyond its own `budgets.mjs`):

```json
{
  "scripts": {
    "benchmark:history": "node node_modules/internal-package-contract/scripts/benchmark/append-history.mjs",
    "benchmark:summary": "node node_modules/internal-package-contract/scripts/benchmark/render-summary.mjs",
    "benchmark:page": "node node_modules/internal-package-contract/scripts/benchmark/render-page.mjs"
  }
}
```

[`benchmark-pr.yml`](.github/workflows/benchmark-pr.yml) is the reusable `workflow_call`
counterpart (same "thin per-repo caller, real logic lives in one reusable workflow" pattern as
`## Release` above): build, run `npm run benchmark:check` and the benchmarks, post or update the PR
comment, and conditionally commit refreshed results and history, keeping the anti-recursion guard
(`github.actor != 'github-actions[bot]'`, same-repo PRs only). It assumes nothing about how many suites
a package has: the caller lists them in `suites` (one `label|directory|history-file` per line), names
any self-contained suite projects needing their own `npm install` in `install-dirs`, and points
`budgets-path` at its `benchmarks/budgets.mjs`. A caller pins the workflow by commit SHA and must bump
that SHA together with its `internal-package-contract` dependency pin.

## Evolving the standard

Per ADR 0010: a review finding becomes a new check here only when it exposes a
**repeatable error class** that materially affects packages and can be
mechanically detected. One-off fixes stay in the package that found them.
