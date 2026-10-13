---
"internal-package-contract": minor
---

feat(mutation): a mutation run over inputs that have not changed in any way is not run again: the evidence of the last clean run for the same hash of every file git does not ignore (and of the Node.js version) is put back for the check to judge, never under CI; `IPC_MUTATION_MEMO=0` runs it regardless

The `Mutation` check also always runs every mutant (`--force`), ignoring any incremental file, so a result carried over from a run made under other conditions can no longer stand in for a cold run.
