// The one standard size ladder every benchmark in this organization is measured on. Ten points that
// double (the last step aside from rounding) so that a log-log fit has enough spread to tell O(1),
// O(log n), O(n), O(n log n) and O(n^2) apart -- three points (the old baseline/stress/extreme) could
// not. Names are `n<size>` so a tier is self-describing in any table or history file.

/** The primary sizes. `n` is whatever one suite declares as its workload unit (a record, a variable, a file...). */
export const STANDARD_TIERS = Object.freeze([20, 40, 80, 160, 320, 640, 1280, 2560, 5120, 10240])

/** A smaller ladder for quick local runs and CI smoke checks (`--quick`). Never used for committed results. */
export const QUICK_TIERS = Object.freeze(STANDARD_TIERS.slice(0, 5))

/**
 * @param {number} size - a tier size.
 * @returns {string} the tier's name, e.g. `n640`.
 */
export function tierName(size) {
  return `n${String(size)}`
}

/**
 * Validates a tier list: at least four distinct positive integers in ascending order (fewer points
 * cannot support a growth-rate estimate).
 * @param {readonly number[]} tiers - candidate sizes.
 * @returns {string[]} problems; empty when valid.
 */
export function validateTiers(tiers) {
  const problems = []
  if (!Array.isArray(tiers) || tiers.length < 4) {
    problems.push(
      "tiers must list at least 4 sizes, or the growth rate (big-O) cannot be estimated",
    )
    return problems
  }
  if (!tiers.every((size) => Number.isInteger(size) && size > 0)) {
    problems.push("tiers must all be positive integers")
  }
  if (tiers.some((size, index) => size <= tiers[index - 1])) {
    problems.push("tiers must be strictly ascending")
  }
  return problems
}
