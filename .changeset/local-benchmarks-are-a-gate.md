---
"internal-package-contract": minor
---

feat(benchmark): a benchmark run outside CI writes to `.benchmark-local/<suite>/`, which is never committed, and the checks read it in preference to the committed results; only CI's figures are committed and published
