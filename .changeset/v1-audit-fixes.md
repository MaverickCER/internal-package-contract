---
"internal-package-contract": minor
---

Make the standard enforceable and honest ahead of 1.0.

- Contract: `standardChecks()`, a `Suppressions` check (inline disables/ignores need a record), a dev-tooling audit, a skipped-tests registry, a required-status-checks `BranchProtection` check, and an exceptions inventory with `--skip`/`--strict`, durable run reports and recorded environment degradations.
- Exceptions: v2 records (owner, expiry, review, scope, rationale and more), `policy-rule` methods, widened Socket types, legacy v1 tolerance.
- Mutation always runs, reports ignored mutants, and covers the exception matcher; the harness runs the full suite.
- Benchmarks: same-run ratio gates, asymptotic fit with R², an accessible server-rendered history page, a post-merge record job and no bot commits into pull requests.
- Release: a split version/build/publish pipeline, npm pinned, a floating `v<major>` tag, workflows pinned by commit SHA and re-pinned with the dependency; nothing automated can publish `1.0.0`.
- Accessibility scans every section and each kind of API page; `ApiContract` targets come from `package.json` exports.
- IPC now holds its own scripts and checks to the standard (coverage, CRAP, duplication, architecture), and depends on `repo-contract` as `~0.8.8`.
- `TOOLKIT.md`: how the four packages relate, and a glossary.
