// Complexity is a promise about how a function scales, so getting worse at it is a decision, not a side
// effect. This module finds every benchmark group whose fitted big-O class got worse than the baseline
// (the last release's results), and matches each one against the exception records a human wrote to accept
// it. The same logic gates the pull-request benchmark run and the `BenchmarkComplexity` contract check,
// so what a pull request is allowed to do is what a release is allowed to ship.
//
// Only a class that got worse counts, and only when its fitted exponent also moved by the shift margin
// (see classify-complexity.mjs), so a label flipping at a class boundary because of noise is not a gain.
// An improvement is never a finding.

import { COMPLEXITY_CLASSES, detectComplexityShift } from "./classify-complexity.mjs"
import { resultsToMeasurements } from "./lib/results.mjs"
import { missingFields, REQUIRED_FIELDS } from "../exception-fields.mjs"
import { isDerivedGroup } from "./page-sections.mjs"

export { missingFields, REQUIRED_FIELDS }

/** Where a repository records the complexity increases it accepts. */
export const REGISTRY_RELATIVE_PATH = ".repo-contract/exceptions/benchmark-complexity.json"

/**
 * @param {string | null | undefined} complexityClass
 * @returns {number} its position from cheapest (0) to worst, or -1 for anything unknown.
 */
export function classRank(complexityClass) {
  return COMPLEXITY_CLASSES.indexOf(complexityClass)
}

/**
 * @typedef {object} Gain
 * @property {string} suite - the benchmark suite's directory name.
 * @property {string} group - the benchmark group.
 * @property {string} previousClass
 * @property {string} currentClass
 * @property {number} previousExponent
 * @property {number} currentExponent
 */

/**
 * @param {string} suite - the suite's directory name.
 * @param {object | null | undefined} baseline - the baseline run's results.json (the last release's).
 * @param {object | null | undefined} current - this run's results.json.
 * @returns {Gain[]} every measured group whose class got worse than the baseline's.
 */
export function complexityGains(suite, baseline, current) {
  const before = resultsToMeasurements(baseline)
  const gains = []
  for (const [group, tiers] of Object.entries(resultsToMeasurements(current))) {
    if (isDerivedGroup(group)) continue
    const shift = detectComplexityShift(before[group], tiers)
    // Stryker disable next-line EqualityOperator: equivalent -- a shift always changes the class, so the two ranks are never equal and `<=` and `<` agree.
    if (!shift.shifted || classRank(shift.currentClass) <= classRank(shift.previousClass)) continue
    gains.push({
      suite,
      group,
      previousClass: shift.previousClass,
      currentClass: shift.currentClass,
      previousExponent: shift.previousExponent,
      currentExponent: shift.currentExponent,
    })
  }
  return gains
}

/**
 * @param {string} suite
 * @param {string} group
 * @param {string} toClass - the class the record accepts.
 * @returns {string} the record id that accepts a group growing to `toClass`.
 */
export function gainExceptionId(suite, group, toClass) {
  return `benchmark-complexity:${suite}:${group}:${toClass}`
}

/**
 * @param {Gain} gain
 * @returns {string} one line saying what got worse.
 */
export function describeGain(gain) {
  return `${gain.suite} / ${gain.group}: ${gain.previousClass} -> ${gain.currentClass} (exponent ${gain.previousExponent.toFixed(2)} -> ${gain.currentExponent.toFixed(2)})`
}

/**
 * Matches each gain with the record that accepts it. A record accepts a group growing to its `to` class
 * or to any cheaper one; growing past it needs a new record, because the human accepted that increase and
 * not a larger one.
 * @param {readonly Gain[]} gains
 * @param {readonly Record<string, unknown>[]} records - the registry's records.
 * @param {Date} now
 * @returns {{ accepted: { gain: Gain, id: string }[], unaccepted: { gain: Gain, id: string, reason: string }[] }}
 */
export function judgeGains(gains, records, now) {
  const accepted = []
  const unaccepted = []
  for (const gain of gains) {
    const id = gainExceptionId(gain.suite, gain.group, gain.currentClass)
    const matching = records.filter(
      (record) =>
        record.suite === gain.suite &&
        record.group === gain.group &&
        classRank(/** @type {string} */ (record.to)) >= classRank(gain.currentClass),
    )
    const complete = matching.find((record) => missingFields(record, now).length === 0)
    if (complete !== undefined) {
      accepted.push({ gain, id: String(complete.id) })
      continue
    }
    const first = matching[0]
    unaccepted.push({
      gain,
      id,
      reason:
        first === undefined
          ? "no record accepts it"
          : `${String(first.id)} is not complete (missing: ${missingFields(first, now).join(", ")})`,
    })
  }
  return { accepted, unaccepted }
}
