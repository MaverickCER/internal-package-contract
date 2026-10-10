// What this repository's own gates cover, in one place (coverage, CRAP, duplication, mutation).
//
// The gates apply to everything this package ships and runs -- `checks/`, `scripts/` and `bin/` --
// not just `checks/`. The only things left out are process entry points: a few lines that read argv
// or the environment, call a function that IS covered, and print. Their tests spawn them as a child
// process, which V8 coverage cannot attribute, so the logic they would hold lives in importable
// modules and the shell is excluded here, by name, never by pattern-matching more than it must.
// Adding a file to this list is a decision that belongs in review.

/** Source trees every gate covers. */
export const SCOPE_DIRS = ["checks", "scripts", "bin"]

/** Process entry points excluded from the gates (see above). */
export const ENTRY_SHELLS = [
  "scripts/check-*.mjs",
  "scripts/audit-dev-deps.mjs",
  "scripts/audit-pins.mjs",
  "scripts/code-scanning-alerts.mjs",
  "scripts/git-hygiene.mjs",
  "scripts/run-*.mjs",
  "scripts/socket-package-score.mjs",
  "scripts/benchmark/run-suite.mjs",
  "bin/*.mjs",
]

/** Declaration files carry no runtime code. */
export const NON_RUNTIME = ["**/*.d.mts", "**/*.d.ts"]
