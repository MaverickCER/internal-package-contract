---
"internal-package-contract": minor
---

feat(clean-checkout): the `CleanCheckout` check type-checks only what git tracks (the index, so staged files count), in a temporary copy with this installation's dependencies linked, so a file hidden by `.gitignore` or never added fails on the machine that has it and not only in CI
