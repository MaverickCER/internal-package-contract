---
"internal-package-contract": minor
---

Take any check apart and put it back: `internal-package-contract/checks/parts` splits a check into its evidence and its policy (`evidenceOf`, `policyOf`, `composeCheck`, `withEvidence`, `withPolicy`, `evidenceOfAll`, `policiesOfAll`). The evidence scripts (`./scripts/*`) and the shared runtime modules (`./runtime/*`) are now exported directly, and an IPC benchmark suite covers the new exports.

`internal-package-contract/logs` re-exports repo-contract's `onEvidenceSaveToRepoContractLogs` and `onVerdictPrependRepoContractLogs` (and `repoContractLogs`), so a package that runs its own contract gets the one-log-per-check hooks without installing `repo-contract`. The contract run itself now uses them, and prints a failure as soon as its verdict exists. Needs `repo-contract` 0.11.0 or later.

`env-cap` and `data-cap` are now dependencies of this package, and every entry point is exported (`internal-package-contract/env-cap`, `/env-cap/build`, `/data-cap`, ...), so a package that uses this one installs neither itself. A new `env` command documents the credentials and settings a package depends on from `ci/env.schema.ts` into `docs/ENVIRONMENT.md`; a new `EnvContract` check warns (never fails) about a credential that is expiring or expired and a document that is out of date; `init` scaffolds the contract, the `docs:env` script and a weekly `env-rotation.yml` workflow (managed by `sync`) that opens one issue when a credential is due; and `doctor` reports it. Nothing in it is required: a package with no contract passes. A missing Socket API key is now a warning in CI as well as locally.
