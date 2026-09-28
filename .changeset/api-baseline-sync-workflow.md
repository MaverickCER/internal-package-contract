---
"internal-package-contract": minor
---

Adds a new reusable `api-baseline-sync.yml` workflow: regenerates a consumer's
committed `ApiContract` baseline (`.repo-contract/api-contract/*/baseline.*`)
on its Changesets "Version Packages" PR branch, via `npx internal-package-contract
update-baseline`, and commits it back -- the generic counterpart to the
bespoke `api-baseline.yml` every consumer used to hand-roll around its own
`contract:baseline` script. Also adds `repo-contract` to `consumers.json`,
so it now receives a dependency-pin-bump PR on future releases like every
other consumer.
