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

## Evidence a reviewer can check

Each package keeps one source of truth, and every document it generates is a projection of that one file, so
two of its documents cannot disagree with each other. The documents use formats a reviewer's own tools already
read (SARIF, OSCAL, CycloneDX, PROV, OpenTelemetry), and each states which facts were declared by a person and
which were found in the code. None of them establishes compliance with a standard, and none is offered as legal
evidence. What they give a security, privacy or audit reviewer is a document in the expected format whose every
line traces back to a file they can inspect, plus a way to check that the document is the one CI produced.

| Package         | Source of truth                                                                                                                                                                                                               | The standard-format documents it generates                                                                                                                                                                    |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `env-cap`       | The Evidence Model (`--evidence`, with a `.fingerprint` sidecar)                                                                                                                                                              | The generated `standards` table in [`specs/generated-artifacts.md`](https://github.com/MaverickCER/env-cap/blob/main/specs/generated-artifacts.md), one row per document with the test that checks its format |
| `data-cap`      | The Evidence Model, including the data-flow evidence                                                                                                                                                                          | The generated `standards` table in [`specs/generated-artifacts.md`](https://github.com/MaverickCER/data-cap/blob/main/specs/generated-artifacts.md)                                                           |
| `repo-contract` | The `Evidence` and `Verdict` documents of a run (`schemas/*.schema.json`)                                                                                                                                                     | None in a standard format; its own repository commits CycloneDX 1.6 SBOMs (checked by `cyclonedx-npm --validate`) and an OpenSSF Scorecard document that leads with the published result                      |
| This repository | The repository itself as GitHub serves it: workflows, branch protection, reviews, releases, dependencies (Scorecard reads these). Each package's `coverage.json`, `mutation.json` and `size.json` feed only its README badges | The OpenSSF Scorecard result, through `ossf/scorecard-action` with `publish_results: true` (required by `ScorecardWorkflow`), produced by OpenSSF's own binary                                                |

Both tables are written by `internal-package-contract generate` from `docs/surface.json`, and the official schemas
the tests validate against are the hash-pinned managed copies in `template/standards/`, so every package states and
checks its formats the same way. What a package installs is generated the same way, in its `dependencies` region.

Two limits a reviewer should know. First, a generated document is unsigned: anyone can edit the file and, for the
`repo-contract` manifest, recompute its digest. Second, the commit and time a document records are supplied by
the caller, never read ambiently. Attesting the document in CI closes the first: it signs the file's digest with
the workflow's identity and records the commit that run built from. It does not check the commit or time written
inside the document, so a reviewer should compare those fields with the commit the attestation names. The CI
step:

```yaml
permissions:
  contents: read
  id-token: write
  attestations: write
steps:
  - run: npx data-cap --evidence docs/data.evidence.json
  - uses: actions/attest-build-provenance@4d101475d8b20a2381f78447822ac1eab6504dd8 # v4.2.2
    with:
      subject-path: docs/data.evidence.json
```

A reviewer then checks that a copy they were given is byte for byte what that repository's CI produced, and reads the commit it was built from in the output:

```sh
gh attestation verify data.evidence.json --repo MaverickCER/data-cap
```

## Glossary

| Word          | Means, and where                                                                                                                                                                                                                                                                  |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Evidence**  | In `repo-contract`: the record of one run of a contract, one entry per check (`Evidence`, `CheckEvidence`). In `env-cap`/`data-cap`: the composed fact model of a project (`EvidenceModel`).                                                                                      |
| **Contract**  | In `repo-contract` and IPC: a set of checks (`defineRepoContract`). In `env-cap`: the schema `createEnv` returns for one capability. In `data-cap`: there is none -- it has _capabilities_.                                                                                       |
| **Manifest**  | In `env-cap`: a generated module the runtime reads. In `data-cap`: a documentation-only artifact; nothing reads it at runtime.                                                                                                                                                    |
| **Exception** | In IPC and `repo-contract`: a record in `.repo-contract/exceptions/*.json` that accepts a specific finding, with its reason, what was attempted, the residual risk, a review date and an expiry (the version 2 fields in EXCEPTIONS.md). In `env-cap`: not used (see _citation_). |
| **Citation**  | In `env-cap`/`data-cap`: a developer-declared `file:line:column` that tells the scanner where a dynamic access happens (`dynamicAccess`). It is not an exception.                                                                                                                 |
| **Verdict**   | In `repo-contract`: the aggregated pass/fail of a run. Never used for a finding in `env-cap`/`data-cap`, which have _findings_ with a severity.                                                                                                                                   |
| **Ownership** | In `env-cap`/`data-cap`: the declared `owner` of a variable or field, and the report built from it. In IPC: the `CODEOWNERS` file. The two meet only in a team's own conventions.                                                                                                 |

## Differences between the packages

Where the four repositories differ on purpose, the reason is here; where they differ for no reason, that is
marked so it gets converged. This table is the record, so a difference that is not listed is a bug in
the table or in the repository. Checked against each repository's default branch on 2026-11-09.

- **Intentional**: stays as it is; the reason is recorded.
- **Open**: needs a decision before it can be called either way.
- **Converge**: no reason found; the next convergence pass removes it.

| Difference                                                                                                                                                                                                                                            | Class       | Reason, or what happens next                                                                                                                                                                                |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `engines.node` is `>=24` here and `>=22` in the three packages                                                                                                                                                                                        | Intentional | This repository is Node-only tooling that nobody installs from npm; the packages support Node 22 and up.                                                                                                    |
| This repository ships raw TypeScript and has no `dist/`; the packages ship a built `dist/`                                                                                                                                                            | Intentional | It is consumed as a git dependency, not published to npm ([ADR 0018](https://github.com/MaverickCER/repo-contract/blob/main/specs/decisions/0018-the-ecosystems-bootstrap-cycle-and-its-package-names.md)). |
| `repo-contract` composes `standardChecks()` in its own `repo-contract.config.ts`, overriding what it must and adding about twenty checks of its own (`checks/standard.ts` says so); `env-cap` and `data-cap` run this repository's bin with no config | Intentional | `repo-contract` hosts the engine this repository depends on, so it extends the standard rather than consuming it unchanged.                                                                                 |
| `repo-contract`'s ESLint config is standalone (about 1,000 lines); `env-cap`, `data-cap` and this repository import the shared baseline                                                                                                               | Open        | Same question as above; it carries rules the baseline does not.                                                                                                                                             |
| `repo-contract`'s `tsconfig.json` does not extend this repository's, and leaves `exactOptionalPropertyTypes` off                                                                                                                                      | Intentional | The reason is written in that file: turning it on surfaces 15+ call sites in the public evidence and policy types.                                                                                          |
| `repo-contract` keeps a `.prettierrc.json` that copies the baseline's options; the others use `prettier.config.mjs`                                                                                                                                   | Converge    | No reason found; it should use the shared Prettier config.                                                                                                                                                  |
| Stryker: `repo-contract` inlines the full config and runs 4 workers; the baseline, `env-cap`, `data-cap` and this repository use 1 worker and extend or import the baseline                                                                           | Converge    | Needs a full Mutation run after the pin bump, because the worker count changes which mutants time out.                                                                                                      |
| GitHub Pages deploy: `env-cap` and `data-cap` hand-roll the job; `repo-contract` calls the reusable `deploy-pages-typedoc.yml`                                                                                                                        | Converge    | One reusable workflow exists for this.                                                                                                                                                                      |
| Benchmark PR job: `env-cap` and `data-cap` call the reusable workflow; `repo-contract` inlines it                                                                                                                                                     | Converge    | Same.                                                                                                                                                                                                       |
| `typescript`: `^6.0.3` everywhere (a runtime dependency here, a dev dependency in the three packages); the consumer template now starts at `^6.0.3` too                                                                                               | Converged   | TypeScript 7 has no compiler API, so the toolchain stays on 6 and 7 is tested in CI.                                                                                                                        |
| `.nvmrc`: 22 in `env-cap`, 24 in the others                                                                                                                                                                                                           | Converge    | `repo-contract`'s CONTRIBUTING says to develop on Node 24 and let CI prove the Node 22 floor.                                                                                                               |
| `env-cap` and `data-cap` pin this repository at `v0.16.0`; `repo-contract` moves there in its next release                                                                                                                                            | Converge    | The pin-sync workflow needs a `PIN_SYNC_TOKEN` with Workflows write to move it; until then the bump is by hand.                                                                                             |

## Duplication left between `env-cap` and `data-cap`

Measured on 2026-10-13 with jscpd (clones of 8 lines or more) over each package's `src/`: 829 lines are still duplicated
between the two packages, and none involve `repo-contract`. Code is moved into the managed set (see
[Shared files](README.md#shared-files)) only when that lowers the cost of maintaining it. Looking alike is not the test:
a managed copy has to be identical in both packages, so the two must really want the same behaviour, and bending
one to fit the other is a cost. The three decisions, with how much of the 829 lines each covers:

| Decision                                       | Lines | Files                                                                                                                  | Why                                                                                                                                                                                                |
| ---------------------------------------------- | ----: | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Move into the managed set**                  |   244 | `cli/filesystem.ts`, `resolve-within-root.ts`, `resolve-import.ts`, `resolve-tsconfig-paths.ts`, `generated-banner.ts` | 80% to 100% identical once the package name is set aside, small, and the same job in both. What is left to settle is a parameter (an error type, a label), not a difference of behaviour.          |
| **Reconcile the behaviour first, then decide** |   205 | `resolve-package-schema.ts`                                                                                            | 54% identical across 548 and 467 lines: both discover a schema across a package boundary but disagree in places that matter. Copying it would freeze a difference nobody has chosen.               |
| **Keep separate**                              |   380 | `define-projection.ts`, `cli/init.ts`, `cli/index.ts`, `sarif.ts`, `literal-eval.ts`, `discover.ts`                    | 18% to 69% identical: the clones are shared structure around code that differs on purpose (what each package reads, reports and prints). A shared module would need a switch for every difference. |

Moving code into the managed set adds no dependency and no release to coordinate (the copy is checked, not installed),
so the cost to weigh is the parameterisation, not versioning. Re-measure after each move; the number to watch is the
duplication that is not a verified copy.

## Part of the MaverickCER toolkit

The shared paragraph every README carries (kept identical on purpose; a test in this repository checks that it matches):

> `@maverickcer/env-cap` governs configuration and `data-cap` governs application data: siblings that apply the same capability-ownership model. `repo-contract` and `internal-package-contract` are how they are verified. See [the toolkit overview and glossary](https://github.com/MaverickCER/internal-package-contract/blob/main/TOOLKIT.md).
