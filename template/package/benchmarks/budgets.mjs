// Highlighting thresholds for the pull-request summary -- NEVER a gate. A group is flagged when its
// median grows by more than `maxRegressionPercent` between runs. Results are not comparable between
// machines (see READING-BENCHMARKS.md), so a threshold must sit above ordinary run-to-run noise:
// microsecond-scale operations routinely swing 30-40% with no code change.
//
// Groups are named by the contract: "end-to-end:overhead", "end-to-end:with-package", "fn:<id>" and
// "fn:<id>@<variant>". "*" applies to every group without its own entry.

export const BUDGETS = {
  "*": { maxRegressionPercent: 40 },
  // The headline number: tighter than the default, because it is what an adopter pays.
  "end-to-end:overhead": { maxRegressionPercent: 25 },
}
