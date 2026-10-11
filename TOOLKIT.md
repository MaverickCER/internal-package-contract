# The MaverickCER toolkit

Four packages, two jobs. This page is the one entry point for "how do these relate", and the glossary
that stops the same word meaning four things.

## What each package governs

| Package                                                          | Governs                                                                                    | You use it to                                                  |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| [`@maverickcer/env-cap`](https://github.com/MaverickCER/env-cap) | **Configuration**: every environment variable has an owner, a purpose and a lifecycle      | Declare, validate and audit environment variables              |
| [`data-cap`](https://github.com/MaverickCER/data-cap)            | **Application data**: every capability's fields have an owner, a sensitivity and consumers | Declare, share and audit the data your application owns        |
| [`repo-contract`](https://github.com/MaverickCER/repo-contract)  | **A repository's rules**: checks, evidence and a verdict                                   | Turn "what must be true of this repo" into an executable check |
| `internal-package-contract` (this repository)                    | **A publishable package's standard**: the checks every package here must keep passing      | Hold env-cap, data-cap and repo-contract to one standard       |

`env-cap` and `data-cap` are siblings: the same capability-ownership model applied to configuration and to
data. They are what you ship. `repo-contract` and `internal-package-contract` are how they are verified:
`repo-contract` is the mechanism (a check graph that produces evidence and a verdict), and
`internal-package-contract` is the policy (the standard those checks encode). It is not published to npm.

## Glossary

| Word          | Means, and where                                                                                                                                                                             |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Evidence**  | In `repo-contract`: the record of one run of a contract, one entry per check (`Evidence`, `CheckEvidence`). In `env-cap`/`data-cap`: the composed fact model of a project (`EvidenceModel`). |
| **Contract**  | In `repo-contract` and IPC: a set of checks (`defineRepoContract`). In `env-cap`: the schema `createEnv` returns for one capability. In `data-cap`: there is none -- it has _capabilities_.  |
| **Manifest**  | In `env-cap`: a generated module the runtime reads. In `data-cap`: a documentation-only artifact; nothing reads it at runtime.                                                               |
| **Exception** | In IPC and `repo-contract`: a record in `.repo-contract/exceptions/*.json` that accepts a specific finding, with an owner, a reason and an expiry. In `env-cap`: not used (see _citation_).  |
| **Citation**  | In `env-cap`/`data-cap`: a developer-declared `file:line:column` that tells the scanner where a dynamic access happens (`dynamicAccess`). It is not an exception.                            |
| **Verdict**   | In `repo-contract`: the aggregated pass/fail of a run. Never used for a finding in `env-cap`/`data-cap`, which have _findings_ with a severity.                                              |
| **Ownership** | In `env-cap`/`data-cap`: the declared `owner` of a variable or field, and the report built from it. In IPC: the `CODEOWNERS` file. The two meet only in a team's own conventions.            |

## Differences between the packages

Where the four repositories differ on purpose, the reason is here; where they differ for no reason, that is
marked so it gets converged. This table is the record, so a difference that is not listed is a bug in
the table or in the repository. Checked against each repository's default branch on 2026-10-10.

- **Intentional**: stays as it is; the reason is recorded.
- **Open**: needs a decision before it can be called either way.
- **Converge**: no reason found; the next convergence pass removes it.

| Difference                                                                                                                                                                                   | Class       | Reason, or what happens next                                                                                                                                                                                |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `engines.node` is `>=24` here and `>=22` in the three packages                                                                                                                               | Intentional | This repository is Node-only tooling that nobody installs from npm; the packages support Node 22 and up.                                                                                                    |
| This repository ships raw TypeScript and has no `dist/`; the packages ship a built `dist/`                                                                                                   | Intentional | It is consumed as a git dependency, not published to npm ([ADR 0018](https://github.com/MaverickCER/repo-contract/blob/main/specs/decisions/0018-the-ecosystems-bootstrap-cycle-and-its-package-names.md)). |
| `repo-contract` has its own `repo-contract.config.ts` with about twenty local checks and does not call `standardChecks()`; `env-cap` and `data-cap` run this repository's bin with no config | Open        | `repo-contract` hosts the engine this repository depends on, so it cannot simply consume the standard. Whether it should adopt more of it is audit finding X-ARCH-2.                                        |
| `repo-contract`'s ESLint config is standalone (about 1,000 lines); `env-cap`, `data-cap` and this repository import the shared baseline                                                      | Open        | Same question as above; it carries rules the baseline does not.                                                                                                                                             |
| `repo-contract`'s `tsconfig.json` does not extend this repository's, and leaves `exactOptionalPropertyTypes` off                                                                             | Intentional | The reason is written in that file: turning it on surfaces 15+ call sites in the public evidence and policy types.                                                                                          |
| `repo-contract` keeps a `.prettierrc.json` that copies the baseline's options; the others use `prettier.config.mjs`                                                                          | Converge    | No reason found; it should use the shared Prettier config.                                                                                                                                                  |
| Stryker: `repo-contract` inlines the full config and runs 4 workers; the baseline, `env-cap`, `data-cap` and this repository use 1 worker and extend or import the baseline                  | Converge    | Needs the pin bump to `v0.10.0` first (its installed baseline predates the 1-worker setting), then a full Mutation run, because the worker count changes which mutants time out.                            |
| GitHub Pages deploy: `env-cap` and `data-cap` hand-roll the job; `repo-contract` calls the reusable `deploy-pages-typedoc.yml`                                                               | Converge    | One reusable workflow exists for this.                                                                                                                                                                      |
| Benchmark PR job: `env-cap` and `data-cap` call the reusable workflow; `repo-contract` inlines it                                                                                            | Converge    | Same.                                                                                                                                                                                                       |
| `typescript` dev dependency: `^6.0.3` in `env-cap`, `data-cap` and here; `^5.0.0` in `repo-contract`                                                                                         | Open        | Decide together with the TypeScript 6 and 7 support work.                                                                                                                                                   |
| `.nvmrc`: 22 in `env-cap`, 24 in the others                                                                                                                                                  | Converge    | `repo-contract`'s CONTRIBUTING says to develop on Node 24 and let CI prove the Node 22 floor.                                                                                                               |
| `repo-contract` pins this repository at `v0.9.0`; `env-cap` and `data-cap` at `v0.10.0`                                                                                                      | Converge    | Pin-sync lag; the pin-sync PR moves it.                                                                                                                                                                     |

## Part of the MaverickCER toolkit

The shared paragraph every README carries (kept identical on purpose; a test in this repository checks that it matches):

> `@maverickcer/env-cap` governs configuration and `data-cap` governs application data: siblings that apply the same capability-ownership model. `repo-contract` and `internal-package-contract` are how they are verified. See [the toolkit overview and glossary](https://github.com/MaverickCER/internal-package-contract/blob/main/TOOLKIT.md).
