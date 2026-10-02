---
"internal-package-contract": patch
---

Let this repository's own CI be started on demand (`workflow_dispatch`), so the dependency-pin sync can run it on the pull requests it opens with its own `GITHUB_TOKEN`, which GitHub does not run CI for by itself.
