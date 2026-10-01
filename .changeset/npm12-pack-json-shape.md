---
"internal-package-contract": patch
---

Accept npm 12's `npm pack --json` output (an object keyed by package name) as well as the older array form in the shared `arethetypeswrong` runner, which every consumer's contract uses.
