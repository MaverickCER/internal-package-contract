---
"internal-package-contract": minor
---

Mutation testing can be split across parallel jobs. `IPC_MUTATION_SHARD=i/n` mutates slice `i` of `n` of the files the Stryker config selects, balanced by size and the same every time, and the `Mutation` check says which slice it judged and does not call an exception for another slice's mutant stale. `scripts/run-merge-mutation-reports.mjs` puts the slices' reports back into the report an unsharded run writes, and fails rather than writing a partial one. `IPC_MUTATION_REPORT=<file>` makes a run judge a report made elsewhere (the merged slices) by the same rule instead of mutating again, and adopts it only if it is evidence about this checkout: every mutant has a Stryker status, it covers exactly the files a full run mutates, and each file is the text on disk. A package whose full run outgrows a single six-hour job can now finish.
