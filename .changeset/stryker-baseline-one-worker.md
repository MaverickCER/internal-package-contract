---
"internal-package-contract": patch
---

The shared Stryker baseline now runs one worker. With several, tests that spawn processes contend for CPU: they time out and count as kills while other mutants lose their attributed runs, so the survivors differ from run to run and a full run is slower, not faster. A consumer with a purely synchronous suite can raise `concurrency`.
