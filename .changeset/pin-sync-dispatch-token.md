---
"internal-package-contract": patch
---

The pin-sync workflow starts CI on its pull request with `GITHUB_TOKEN`, not `PIN_SYNC_TOKEN`.

- **Why.** A `PIN_SYNC_TOKEN` without Actions write made every dispatch fail with HTTP 403. The pull request
  then sat open with no CI run. GitHub lets `GITHUB_TOKEN` dispatch a workflow, and the caller already grants
  it `actions: write`.
- **The token's job is smaller.** It pushes workflow-file changes and merges the pull request after CI passes,
  so the merge still starts the release workflow. It needs Contents, Pull requests and Workflows write; Actions
  access is no longer needed. `docs/ENVIRONMENT.md`, the README and `doctor`'s advice say so.
- **The first re-pin can still fail once.** A consumer's first re-pin to this release still runs its old pinned
  workflow. So a token without Actions write fails that one dispatch. Start the pull request's CI by hand once:
  under Actions, pick CI (Contract in a scaffolded package), then Run workflow on the bump branch. Or push to
  that branch.
