---
"internal-package-contract": minor
---

Add `--scope affected|full|auto` (and `--base <ref>`) to the contract run, built on `repo-contract` 0.12's affected-scope analysis. A bare run covers everything, as before. `--scope affected` runs only what the working tree's changes can affect: the `Tests` check names only the affected test files, `Mutation` mutates only the affected sources, `Crap` weighs only the functions of the affected files, and `Coverage` reports that the package-wide aggregate is not evaluated (a warning, never a pass) because a narrowed run cannot say it. `--scope auto` lets the environment decide: a pull request narrows, a push and a release do not, and `CI_FULL` forces everything. Wherever the analysis cannot be sure (a lockfile or tool config changed, a file it cannot place, a module that does not parse, git failing) it says so and everything runs. The scope is written to `reports/contract/scope.json` and printed at the start of the run.

The pre-commit hook now runs `--scope affected`, and the Contract workflow template and this repository's CI run `--scope auto`. A push to main and a release still run everything, cold.
