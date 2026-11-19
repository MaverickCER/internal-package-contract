---
"internal-package-contract": patch
---

The managed `ci-jobs-test` reads `.github/workflows/contract.yml` when the package has no `ci.yml`, so it works in a package `init` scaffolded. Before, it failed there with ENOENT.

The README now names the checks that write a blank registry record for each new finding: `SecurityDeps`, `SecuritySocket`, `CodeScanning`, `DistNoUrls` and `CodeRabbit`.
