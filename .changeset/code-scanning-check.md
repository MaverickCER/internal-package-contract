---
"internal-package-contract": minor
---

Add the local-only `CodeScanning` check. It reads the repository's open GitHub code-scanning alerts with your own `gh` login (a no-op in CI) and judges each by where it is: an alert in code that builds, runs or ships must be fixed and cannot be waived; an alert in development-only code (tests, unpublished `scripts/`, docs, examples, benchmarks, `.github/`, `*.config.*`) is rejected with a standing, auto-written record in the git-ignored `.repo-contract/exceptions/code-scanning.json` (the only accepted `exceptionType` is the new `dev-only-not-shipped`). `init` now ignores that registry. The shared workflows and the scaffolded `contract.yml` no longer use any npm or action caches, and the Socket-score `actions/cache` step is gone, because a cache written by a workflow that runs pull-request code can be poisoned (CodeQL `actions/cache-poisoning`). Also fixes the incomplete tag sanitization in `check-docs-fragments.mjs`.
