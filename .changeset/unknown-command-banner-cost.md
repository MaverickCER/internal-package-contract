---
"internal-package-contract": patch
---

A mistyped command now stops with a suggestion instead of starting the whole contract. `isGeneratedFile` in the shared runtime reads only the first twenty non-empty lines instead of splitting the entire file, so its cost no longer grows with the file; packages pick it up with `sync --apply --update`.
