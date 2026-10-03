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

## Part of the MaverickCER toolkit

The shared paragraph every README carries (kept identical on purpose; a test in this repository checks that it matches):

> `@maverickcer/env-cap` governs configuration and `data-cap` governs application data: siblings that apply the same capability-ownership model. `repo-contract` and `internal-package-contract` are how they are verified. See [the toolkit overview and glossary](https://github.com/MaverickCER/internal-package-contract/blob/main/TOOLKIT.md).
