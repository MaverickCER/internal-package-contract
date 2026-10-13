// Tuning for the benchmark gates. Nothing here is needed: the defaults in internal-package-contract
// (scripts/benchmark/gates.mjs) apply to every group, and a package overrides only what it must, for
// example `export const GATES = { normalizedOverheadMaxIncreasePercent: { millisecondScale: 60 } }`.
//
// There is no threshold on a raw time. Results are not comparable between machines (see
// READING-BENCHMARKS.md), so a pull request is judged on properties of one run instead: the measured
// big-O against the documented one (a function whose big-O cannot be determined is a warning), and the
// overhead as a ratio to the bare baseline.

export const GATES = {}
