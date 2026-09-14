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
`repo-contract`, every executor, and every tool config transitively — one
devDependency.

## Adopt it

```sh
npm i -D internal-package-contract    # or "file:../internal-package-contract"
npx internal-package-contract init    # scaffold repo files + wire git hooks
npm run contract
```

`init` is non-destructive (`--force` to overwrite). It:

- writes `.gitignore`, `.gitattributes`, `.editorconfig`, `.gitmessage`,
  `.nvmrc`, `.github/workflows/contract.yml`,
  `.github/workflows/release.yml` (only the ones you're missing);
- sets `package.json` `scripts.contract`;
- sets `git config core.hooksPath` → the bundled hooks and
  `commit.template` → `.gitmessage`.

**Bundled git hooks** (skip any with `--no-verify`):

| Hook         | Runs                                                                 |
| ------------ | -------------------------------------------------------------------- |
| `pre-commit` | `Format`, `Lint`                                                     |
| `commit-msg` | Conventional Commits check on the message                            |
| `pre-push`   | everything except the slow analyses (`Coverage`, `Crap`, `Mutation`) |

## The 29 checks

[`contract.ts`](contract.ts) — read-only against the consumer's source tree.
`Build` / `Tests` write only build + coverage + report artifacts, which
[`bin/contract.mjs`](bin/contract.mjs) cleans up. Every tool that needs a config
uses the consumer's own if present, **otherwise a bundled default from
[`config/`](config/)** — so the contract enforces real rules on day one.

Three declaration-order phases (repo-contract ADR 0002):

### 1 — Writers

| Check                   | How                                      | Blocks on                                                                                   |
| ----------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------- |
| `ApiDocs`               | `npm run docs:api` \*                    | the API-docs build failing                                                                  |
| `SuppressionGovernance` | TS-compiler-scanned suppression comments | any `eslint-disable`/`@ts-expect-error`/`Stryker disable` with no reviewed exception record |
| `Lint`                  | `eslint . --format json`                 | any ESLint **error** (warnings warn)                                                        |
| `Format`                | `prettier --check .`                     | any unformatted file                                                                        |
| `Schema`                | `npm run schema` \* + hash diff          | the script failing **or** regenerating a committed file                                     |

### 2 — Build barrier

`Build` — `npm run build`, `isolated`. Writers finish first; readers wait, so
the packaging checks see a fresh `dist/`.

### 3 — Readers (concurrent)

| Check             | How                                                                               | Blocks on                                                                                            |
| ----------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `Typecheck`       | `tsc --noEmit -p tsconfig.json`                                                   | any type error                                                                                       |
| `Tests`           | `vitest run` **with** V8 coverage, once                                           | any failing / errored test                                                                           |
| `Architecture`    | `depcruise src` — bundled `config/dependency-cruiser.cjs`                         | any error-severity violation (circular deps, etc.)                                                   |
| `GithubActions`   | `actionlint`                                                                      | any workflow finding (no workflows → pass)                                                           |
| `GitHygiene`      | tracked build output, conflict markers, `.gitignore` gaps, `package.json` `files` | a repo-maintenance defect                                                                            |
| `Coverage`        | reads `Tests`' summary vs. `COVERAGE_THRESHOLDS` (80%)                            | any metric below threshold                                                                           |
| `Crap`            | `crap4ts src` — CRAP ≤ 30, cyclomatic ≤ 20 (`dependsOn Coverage`)                 | any function over either ceiling                                                                     |
| `Size`            | `npm run size` \*                                                                 | the consumer's size script failing                                                                   |
| `Duplication`     | `jscpd src`                                                                       | any copy-pasted block in `src/`                                                                      |
| `Packaging`       | `publint`                                                                         | any packaging **error** (warnings warn)                                                              |
| `TypeResolution`  | `attw` on the packed tarball (`./schema` excluded)                                | any packaged type-resolution problem                                                                 |
| `Licenses`        | `licensee --production --osi`                                                     | any shipped dep without an OSI license                                                               |
| `DocsMarkdown`    | `markdownlint-cli2` — bundled `config/markdownlint.jsonc`                         | any markdown issue                                                                                   |
| `DocsLinks`       | `linkinator` from `README.md`, recursive                                          | any broken **local** link (external rot warns)                                                       |
| `DocsFragments`   | heading-fragment resolution across hand-authored Markdown                         | any `#fragment`/`file.md#fragment` link matching no real heading                                     |
| `Accessibility`   | `pa11y` against `docs/**/*.html`                                                  | any WCAG2AA issue                                                                                    |
| `SecurityDeps`    | `npm audit --omit=dev` — reviewed exception registry                              | any advisory with no complete, reviewed exception record                                             |
| `SecuritySecrets` | `secretlint` — bundled `config/secretlint.config.json`                            | any detected secret                                                                                  |
| `SecuritySocket`  | `socket ci` (Socket.dev) — reviewed exception registry                            | any alert with no complete, reviewed exception record (not installed/authenticated → warn)           |
| `DeadCode`        | `knip` — bundled `config/knip.json`                                               | any unused file/export/dep, unlisted import                                                          |
| `Commits`         | `commitlint origin/main..HEAD` — bundled config                                   | any non-Conventional-Commit (no base branch → warn)                                                  |
| `PresetCommands`  | TS-AST-scanned `run:` properties in `checks/*.ts` — reviewed exception registry   | any spawned command with no reviewed record, or a non-literal `run:` (never registry-waivable)       |
| `Mutation`        | Stryker vs. `MUTATION_THRESHOLD` (80%), `isolated`                                | score below threshold — **only runs with a `stryker.config.*` or `IPC_MUTATION=1`; otherwise warns** |

\* runs the consumer's own npm script; **skipped with a note** if absent.

### Not cloned from `repo-contract.config.ts`

`api-contract`, `security-network`, `adr-governance`, and the
`test-unit/integration/property/e2e` split — each is keyed to repo-contract's
own `src/`-layout/semver-publishing conventions rather than a general package
standard.

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

The thresholds `COVERAGE_THRESHOLDS`, `CRAP_THRESHOLD` / `MAX_COMPLEXITY`,
`MUTATION_THRESHOLD` live in [`checks/`](checks/) — raise them there when the
whole fleet is ready, never per-consumer.

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
