---
"internal-package-contract": minor
---

Adds the `ApiContract` engine as a new bundled check (`contract.ts`'s own
`ApiContract`, exported for external consumption at
`internal-package-contract/checks/api-contract`): diffs every consumer target's
real, current public API (API Extractor diffing + TypeChecker assignability
probing, generalized over the consumer's own `typedoc.json` entry points)
against its committed baseline, and fails when the branch's Changesets
under-declare the resulting semver bump. Ported from `repo-contract`'s own
previously-duplicated `checks/api-contract.ts`, adapted for a
Changesets-declared bump instead of a Conventional-Commits-declared one, and
for a consumer with several independent public entry points instead of one.

Also adds two smaller writer checks to `contract.ts`: `ApiDocsReport` (keeps a
consumer's committed `docs/api-report/` in sync with `docs:api:report`) and
`ReadmeExample` (keeps a consumer's README example prose in sync with its own
example CLI output, skipped when the consumer defines no
`verify:readme-example` script). `internal-package-contract/checks/npm-script`
(the generic `npmScriptCheck` factory both of these -- and `ApiDocsReport`
specifically -- are built from) is now exported too, so a consumer with its
own bespoke contract config (like `repo-contract`) can compose the same
building block directly instead of duplicating it.
