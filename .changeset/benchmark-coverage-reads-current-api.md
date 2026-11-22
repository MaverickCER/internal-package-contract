---
"internal-package-contract": patch
---

`BenchmarkCoverage` judges the API the branch ships. It read only the committed baselines, which move only with a
release, so a benchmark for a function added on a branch was reported stale. Clearing that meant editing a baseline,
which `ApiContract` forbids outside a release. Each target is now read from the `current.*` files `ApiContract`
writes, else from its `baseline.*`, and `BenchmarkCoverage` runs after `ApiContract`. Targets nested below
`.repo-contract/api-contract/`, such as `adapters/express/`, are read too; before, only the top level was.

Each function's parameter types are resolved in its own target, so two targets that each declare an `Options`
no longer overwrite each other. `ApiContract` removes a target's `current.api.json` and `current.d.ts` before it
extracts, so a failed extraction leaves the baseline for `BenchmarkCoverage` to read, not the last run's API.
