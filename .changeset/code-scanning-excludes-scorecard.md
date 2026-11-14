---
"internal-package-contract": patch
---

`CodeScanning` leaves out OpenSSF Scorecard findings. Scorecard uploads its results as code-scanning alerts, but they rate the repository (maintenance, code review, branch protection, dependency advisories, workflow token scopes), not code. The check treated the ones with no file as alerts in shipped code. They have no exception path, so every consumer's `main` failed `contract` once Scorecard had run. Pull requests still passed, because Scorecard only analyses `main`. The Scorecard report and badge still show these findings.
