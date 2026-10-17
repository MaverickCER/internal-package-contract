---
"internal-package-contract": minor
---

fix(mutation): a mutant that times out is run again alone before it counts, so a stalled machine is not reported as a loop, and the reuse of an earlier run keeps only a run in which every mutant was caught or left out
