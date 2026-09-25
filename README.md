# internal-package-contract

The engineering standard every publishable `@maverickcer/*` package must
**continuously satisfy** — and the configs, git wiring, and one-command setup to
adopt it. A clone of repo-contract's own
[`repo-contract.config.ts`](https://github.com/MaverickCER/repo-contract/blob/main/repo-contract.config.ts),
adapted to govern a _consuming_ package.

It is the "package" row of the layered governance model
([repo-contract ADR 0010](https://github.com/MaverickCER/repo-contract/blob/main/specs/decisions/0010-review-driven-contracts-and-shared-internal-system-contracts.md)):

| Layer                           | Owns                                       | Answers                                         |
| ------------------------------- | ------------------------------------------ | ----------------------------------------------- |
| `repo-contract`                 | execution, evidence, policy mechanism      | _How_ is a requirement turned into a verdict?   |
| **`internal-package-contract`** | the standard for a publishable package     | _What_ must every package continuously satisfy? |
| `env-cap`, `data-cap`, …        | package-specific checks and implementation | _What else_ does this one package require?      |

**Not published to npm** (repo-contract cannot depend on it — that would be
circular). Consumers depend on it with a `file:` / git range and get
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

(`internal-package-contract` itself can be a `file:../internal-package-contract`
or git range instead of a registry version, per "Not published to npm" above;
the other four are ordinary registry devDependencies every TypeScript +
Vitest package already needs.)

`init` is non-destructive (`--force` to overwrite). It:

- writes `.gitignore`, `.gitattributes`, `.editorconfig`, `.gitmessage`,
  `.nvmrc`, `.github/workflows/contract.yml`,
  `.github/workflows/release.yml`, `CODEOWNERS`, `SECURITY.md`,
  `CONTRIBUTING.md` (only the ones you're missing);
- sets `package.json` `scripts.contract`;
- sets `git config core.hooksPath` → the bundled hooks and
  `commit.template` → `.gitmessage`;
- idempotently configures a GitHub ruleset on the default branch (via the
  `gh` CLI, best-effort -- skipped with a warning if `gh` isn't
  installed/authenticated) blocking deletion, blocking force-pushes, and
  requiring every merge to go through a pull request.

There's no programmatic import of this package -- `contract.ts` ships as raw
TypeScript (Node refuses to type-strip `.ts` under `node_modules`, so a plain
`import("internal-package-contract")` doesn't work), and nothing in this
fleet needs one. The `internal-package-contract` CLI (which loads
`contract.ts` internally via `tsx`) is the one supported way to run it; use
`./eslint`, `./prettier`, `./tsconfig`, and `./config/*` for the individual
tool configs.

**Bundled git hooks** (skip any with `--no-verify`):

| Hook         | Runs                                                                 |
| ------------ | -------------------------------------------------------------------- |
| `pre-commit` | `Format`, `Lint`                                                     |
| `commit-msg` | Conventional Commits check on the message                            |
| `pre-push`   | everything except the slow analyses (`Coverage`, `Crap`, `Mutation`) |

## The 28 checks

[`contract.ts`](contract.ts) — read-only against the consumer's source tree.
`Build` / `Tests` write only build + coverage + report artifacts, which
[`bin/contract.mjs`](bin/contract.mjs) cleans up. Every tool that needs a config
uses the consumer's own if present, **otherwise a bundled default from
[`config/`](config/)** — so the contract enforces real rules on day one.

Three declaration-order phases (repo-contract ADR 0002):

### 1 — Writers

| Check     | How                             | Blocks on                                               |
| --------- | ------------------------------- | ------------------------------------------------------- |
| `ApiDocs` | `npm run docs:api` \*           | the API-docs build failing                              |
| `Lint`    | `eslint . --format json`        | any ESLint **error** (warnings warn)                    |
| `Format`  | `prettier --check .`            | any unformatted file                                    |
| `Schema`  | `npm run schema` \* + hash diff | the script failing **or** regenerating a committed file |

### 2 — Build barrier

`Build` — `npm run build`, `isolated`. Writers finish first; readers wait, so
the packaging checks see a fresh `dist/`.

### 3 — Readers (concurrent)

| Check              | How                                                                                | Blocks on                                                                                                               |
| ------------------ | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `Typecheck`        | `tsc --noEmit -p tsconfig.json`                                                    | any type error                                                                                                          |
| `Tests`            | `vitest run` **with** V8 coverage, once                                            | any failing / errored test                                                                                              |
| `Architecture`     | `depcruise src` — bundled `config/dependency-cruiser.cjs`                          | any error-severity violation (circular deps, etc.)                                                                      |
| `GithubActions`    | `github-actionlint` (npm wrapper for actionlint)                                   | any workflow finding (no workflows → pass)                                                                              |
| `GitHygiene`       | tracked build output, conflict markers, `.gitignore` gaps, `package.json` `files`  | a repo-maintenance defect                                                                                               |
| `BranchProtection` | `gh api` against the default branch's GitHub ruleset                               | deletion / force-push / PR-required protection missing (warns if `gh` unavailable)                                      |
| `Coverage`         | reads `Tests`' summary vs. `COVERAGE_THRESHOLDS` (80%)                             | any metric below threshold                                                                                              |
| `Crap`             | `crap4ts src` — CRAP ≤ 30, cyclomatic ≤ 20 (`dependsOn Coverage`)                  | any function over either ceiling                                                                                        |
| `Size`             | `npm run size` \*                                                                  | the consumer's size script failing                                                                                      |
| `Duplication`      | `jscpd src`                                                                        | duplication above the 0.75% budget                                                                                      |
| `Packaging`        | `publint`                                                                          | any packaging **error** (warnings warn)                                                                                 |
| `TypeResolution`   | `attw` on the packed tarball (`./schema` excluded)                                 | any packaged type-resolution problem                                                                                    |
| `Licenses`         | `licensee --production --osi`                                                      | any shipped dep without an OSI license                                                                                  |
| `DocsMarkdown`     | `markdownlint-cli2` — bundled `config/markdownlint.jsonc`                          | any markdown issue                                                                                                      |
| `DocsLinks`        | `linkinator`, recursive: Markdown crawl from `README.md` + HTML crawl over `docs/` | any broken **local** link (external rot warns)                                                                          |
| `DocsFragments`    | bundled `scripts/check-docs-fragments.mjs`                                         | a `filename.md#fragment` link whose fragment isn't a real heading (a gap neither `DocsMarkdown` nor `DocsLinks` covers) |
| `Accessibility`    | `pa11y` (WCAG2AA) against the consumer's own built docs site                       | any accessibility violation (no built site to scan → warn)                                                              |
| `SecurityDeps`     | `npm audit --omit=dev`                                                             | any advisory of any severity, including `info` (no severity-tiered waiver; every finding needs a full exception record) |
| `SecuritySecrets`  | `secretlint` — bundled `config/secretlint.config.json`                             | any detected secret                                                                                                     |
| `SecuritySocket`   | `socket ci --json` (`@socketsecurity/cli`)                                         | any `critical`/`high` alert (forbidden, no waiver); `middle`/`low` waivable via the exception registry                  |
| `DeadCode`         | `knip` — bundled `config/knip.json`                                                | any unused file/export/dep, unlisted import                                                                             |
| `Commits`          | `commitlint origin/main..HEAD` — bundled config                                    | any non-Conventional-Commit (no base branch → warn)                                                                     |
| `Mutation`         | Stryker, zero-tolerance (`isolated`)                                               | any Survived/NoCoverage/Timeout mutant — **only runs with a `stryker.config.*` or `IPC_MUTATION=1`; otherwise warns**   |

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
instead of quietly no-op'ing. `Mutation`, `Accessibility` (no built docs site
yet), and `BranchProtection` (no `.git`/GitHub remote yet) are the exceptions
that _do_ default to a warn instead (see their rows above). Run `git init`
and add a `tsconfig.json` / `eslint.config.mjs` (extending this package's
own) and a `src/` tree to bring the rest green — Step 2 of adoption, not
Step 1.

### Not cloned from `repo-contract.config.ts`

`suppression-governance`, `api-contract`, `security-network`,
`adr-governance`, and the `test-unit/integration/property/e2e` split — each
encodes repo-contract's own design rather than a general package standard.

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
IPC_MUTATION=1 npx internal-package-contract --checks Mutation
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

## Evolving the standard

Per ADR 0010: a review finding becomes a new check here only when it exposes a
**repeatable error class** that materially affects packages and can be
mechanically detected. One-off fixes stay in the package that found them.
