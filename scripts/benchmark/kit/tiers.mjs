// The one standard size ladder every benchmark is measured on. The sizes double (the last step aside from
// rounding), so a log-log fit has enough spread to tell the classes apart. `validateTiers` refuses a ladder
// with fewer than four sizes, or one that is not strictly ascending positive integers. Names are `n<size>`, so
// a tier is self-describing in any table or history file. `QUICK_TIERS` is the short prefix `--quick` runs use.

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
