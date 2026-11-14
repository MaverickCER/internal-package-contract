// What a benchmark run may fail a pull request for, and what it may not.
//
// A raw millisecond delta between two runs on different runners is never a gate. Only a property of one run,
// or a ratio of two quantities measured in the same run, is judged.
//
//   1. complexity          `fail`: a function whose measured class is two or more classes from its documented
//                          one (`agreement: "differs"`, kit/run.mjs). Off when a package's `GATES` sets
//                          `complexity: false`.
//   2. normalized overhead `fail`: the package's added time as a percentage of the bare baseline grew past the
//                          allowed increase against a reference (the last run on main, the last release, or
//                          main measured on this runner). The allowance is looser for sub-millisecond work.
//                          A baseline under the noise floor is not judged. A reference from another CPU model
//                          is not judged either, unless it was measured on this runner. A change inside the
//                          two runs' 95% intervals is a `note`, not a failure.
//   3. undetermined        `warn`: a group whose class could not be fitted. Nothing is known to be wrong or
//                          right, so it never fails.
//   4. complexity gain     `fail`: a group whose class got worse than at the last release with no complete
//                          record in `.repo-contract/exceptions/benchmark-complexity.json`
//                          (complexity-gain.mjs); an accepted gain is a `note`.
//   5. environment         `note`: the two runs differ in Node major or CPU model, so raw deltas mean little.
//
// A package overrides any threshold with a `GATES` export in its budgets file. render-summary.mjs renders
// these levels. Only its `--gate` flag turns a `fail` into a non-zero exit.

import { explainUndetermined } from "./explain-undetermined.mjs"
import {
  complexityGains,
  describeGain,
  judgeGains,
  REGISTRY_RELATIVE_PATH,
} from "./complexity-gain.mjs"

/** The default gate settings; a package overrides any of them with a `GATES` export in its budgets file. */
export const DEFAULT_GATES = Object.freeze({
  /** Fail when a function's measured growth class differs from its documented one. */
  complexity: true,
  /** Fail when normalized overhead grows by more than this percent against a reference... */
  normalizedOverheadMaxIncreasePercent: Object.freeze({
    /** ...for work whose baseline is at least `microscaleBelowMs`. */
    millisecondScale: 50,
    /** ...for work whose baseline is below it. */
    microsecondScale: 70,
    microscaleBelowMs: 1,
  }),
  /** A baseline this fast (ms) is within timer noise: the ratio is not judged. */
  noiseFloorBaselineMs: 0.005,
})

/**
 * @typedef {object} Finding
 * @property {"fail" | "warn" | "note"} level - `fail` fails a gated run; `warn` needs a look but never fails it; `note` is information.
 * @property {"complexity" | "complexity-undetermined" | "complexity-gain" | "normalized-overhead" | "environment"} kind
 * @property {string} message
 */

/**
 * Merges a package's `GATES` over the defaults, one level deep.
 * @param {object | undefined} overrides
 * @returns {typeof DEFAULT_GATES}
 */
export function resolveGates(overrides) {
  return {
    ...DEFAULT_GATES,
    ...overrides,
    normalizedOverheadMaxIncreasePercent: {
      ...DEFAULT_GATES.normalizedOverheadMaxIncreasePercent,
      ...overrides?.normalizedOverheadMaxIncreasePercent,
    },
  }
}

/**
 * The end-to-end row at the typical size, which is what the headline overhead is judged at.
 * @param {object | undefined} results
 * @returns {{ n: number, baselineMs: number, overheadPercent: number | null } | undefined}
 */
function typicalOverhead(results) {
  const typical = results?.analysis?.cost?.typical
  if (!typical || typeof typical.baselineMs !== "number") return undefined
  return {
    n: typical.n,
    baselineMs: typical.baselineMs,
    overheadPercent: typical.overheadPercent,
    // The half-width of the overhead's 95% interval, in percentage points; absent before paired sampling.
    ci95Percent:
      typeof typical.overheadCi95Percent === "number" ? typical.overheadCi95Percent : null,
    // Stryker disable next-line OptionalChaining: equivalent -- `results` is an object here, the guard above returned on anything else.
    cpuModel: results?.metadata?.environment?.cpuModel,
  }
}

const points = (value) => `${value.toFixed(1)} points`
const interval = (figure) =>
  figure.ci95Percent === null ? "no interval" : `±${points(figure.ci95Percent)}`

/**
 * @param {object | undefined} current - this run's results.json.
 * @returns {Finding[]} one failure per function whose measured growth class differs from its documentation.
 */
export function complexityFindings(current) {
  const findings = []
  for (const [group, value] of Object.entries(current?.analysis?.complexity ?? {})) {
    if (value?.agreement !== "differs") continue
    findings.push({
      level: "fail",
      kind: "complexity",
      message: `\`${group}\`: documented ${value.expectedNotation ?? value.expected}, measured ${value.notation ?? value.class} (exponent ${typeof value.exponent === "number" ? value.exponent.toFixed(2) : "n/a"}, R² ${typeof value.rSquared === "number" ? value.rSquared.toFixed(2) : "n/a"}). Either the code regressed or the documented big-O is wrong; decide which and fix it.`,
    })
  }
  return findings
}

/**
 * @param {object | undefined} current - this run's results.json.
 * @returns {Finding[]} one warning per group whose big-O could not be determined, with why.
 */
export function undeterminedFindings(current) {
  const findings = []
  for (const [group, value] of Object.entries(current?.analysis?.complexity ?? {})) {
    if (value?.class !== null) continue
    findings.push({
      level: "warn",
      kind: "complexity-undetermined",
      message: `\`${group}\`${value.variable === undefined ? "" : ` (varying ${value.variable})`}: the big-O could not be determined: ${explainUndetermined(value)}. It is not checked against ${value.expectedNotation === undefined ? "its documentation" : `the documented ${value.expectedNotation}`}.`,
    })
  }
  return findings
}

/**
 * @param {{ suite: string, release: object | null | undefined, current: object | undefined, records: readonly Record<string, unknown>[], now: Date }} input
 * @returns {Finding[]} a failure for each group that got worse than at the last release with no complete record
 *   accepting it, and a note for each one a record does accept.
 */
export function complexityGainFindings({ suite, release, current, records, now }) {
  const judged = judgeGains(complexityGains(suite, release, current), records, now)
  return [
    ...judged.unaccepted.map(({ gain, id, reason }) => ({
      level: "fail",
      kind: "complexity-gain",
      message: `${describeGain(gain)}. It got worse at big-O than at the last release and no human has accepted it. Fix the regression, or review it and record the decision as ${id} in ${REGISTRY_RELATIVE_PATH} (${reason}).`,
    })),
    ...judged.accepted.map(({ gain, id }) => ({
      level: "note",
      kind: "complexity-gain",
      message: `${describeGain(gain)}. Accepted by ${id}.`,
    })),
  ]
}

/**
 * @param {object | undefined} current - this run's results.json.
 * @param {{ name: string, results: object | null | undefined }[]} references - the runs to compare the normalized overhead against.
 * @param {ReturnType<typeof resolveGates>} gates
 * @returns {Finding[]}
 */
export function overheadFindings(current, references, gates) {
  const now = typicalOverhead(current)
  if (!now) return []
  if (now.baselineMs < gates.noiseFloorBaselineMs) return []
  const limits = gates.normalizedOverheadMaxIncreasePercent
  const allowed =
    now.baselineMs < limits.microscaleBelowMs ? limits.microsecondScale : limits.millisecondScale
  const findings = []
  for (const { name, results, sameMachine = false } of references) {
    const then = typicalOverhead(results)
    if (!then || !(then.overheadPercent > 0)) {
      // The same-runner reference is the one the gate judges: its absence is worth a line, so a
      // maintainer knows the ratio was compared only with committed results, if with anything.
      if (sameMachine) {
        findings.push({
          level: "note",
          kind: "normalized-overhead-unjudged",
          message: `main could not be measured on this runner for this suite (${name}), so the overhead ratio is judged only against committed results from this CPU model.`,
        })
      }
      continue
    }
    if (then.baselineMs < gates.noiseFloorBaselineMs) continue
    if (typeof now.overheadPercent !== "number") continue
    // The ratio is a property of one run, but for work this fast it is also a property of the
    // machine: how much of the baseline is process start-up versus the package's own work. So two
    // CPU models are compared only when both were measured on this runner.
    if (!sameMachine && now.cpuModel && then.cpuModel && now.cpuModel !== then.cpuModel) {
      findings.push({
        level: "note",
        kind: "normalized-overhead-unjudged",
        message: `Overhead relative to the baseline is ${now.overheadPercent.toFixed(1)}% here and was ${then.overheadPercent.toFixed(1)}% (${name}), but that run was on ${then.cpuModel} and this one on ${now.cpuModel}: the ratio is not judged across machines.`,
      })
      continue
    }
    const increase = (now.overheadPercent / then.overheadPercent - 1) * 100
    if (increase <= allowed) continue
    const grew = `Overhead relative to the baseline grew from ${then.overheadPercent.toFixed(1)}% (${name}) to ${now.overheadPercent.toFixed(1)}%`
    const delta = now.overheadPercent - then.overheadPercent
    const width = (now.ci95Percent ?? 0) + (then.ci95Percent ?? 0)
    const intervals = `the measurements' 95% intervals (${interval(now)} here, ${interval(then)} then)`
    if (delta <= width) {
      findings.push({
        level: "note",
        kind: "normalized-overhead-within-interval",
        message: `${grew}, up ${increase.toFixed(0)}%, over the ${String(allowed)}% allowed for work this fast, but the change (${points(delta)}) is inside ${intervals}: not a regression this run can see.`,
      })
      continue
    }
    findings.push({
      level: "fail",
      kind: "normalized-overhead",
      message: `${grew}, up ${increase.toFixed(0)}%, over the ${String(allowed)}% allowed for work this fast, and the change (${points(delta)}) is outside ${intervals}${sameMachine ? "; both were measured on this runner in this job" : ""}.`,
    })
  }
  return findings
}

/**
 * Notes that two runs are not directly comparable even for ratios (a different Node major changes the
 * engine; a different runtime changes everything).
 * @param {object | null | undefined} previous
 * @param {object | undefined} current
 * @returns {Finding[]}
 */
export function environmentNotes(previous, current) {
  const a = previous?.metadata?.environment
  const b = current?.metadata?.environment
  if (!a || !b) return []
  const notes = []
  const major = (version) => String(version).replace("v", "").split(".")[0]
  if (a.nodeVersion && b.nodeVersion && major(a.nodeVersion) !== major(b.nodeVersion)) {
    notes.push({
      level: "note",
      kind: "environment",
      message: `The previous run used Node ${a.nodeVersion} and this one Node ${b.nodeVersion}: raw time deltas are not comparable (the engine differs), only the same-run gates are meaningful.`,
    })
  }
  if (a.cpuModel && b.cpuModel && a.cpuModel !== b.cpuModel) {
    notes.push({
      level: "note",
      kind: "environment",
      message: `The previous run was on ${a.cpuModel} and this one on ${b.cpuModel}: raw time deltas compare two different machines.`,
    })
  }
  return notes
}

/**
 * Every gate finding for one suite.
 * @param {{ previous?: object | null, release?: object | null, current?: object, gates?: object, exceptions?: { suite: string, records: readonly Record<string, unknown>[], now: Date } }} input
 * @returns {Finding[]}
 */
export function evaluateGates({
  previous,
  release,
  sameMachineMain,
  current,
  gates: overrides,
  exceptions,
}) {
  const gates = resolveGates(overrides)
  const references = [
    { name: "last run on main", results: previous },
    { name: "last release", results: release },
  ]
  if (sameMachineMain) {
    references.push({
      name: "main measured on this runner",
      results: sameMachineMain,
      sameMachine: true,
    })
  }
  return [
    ...(gates.complexity ? complexityFindings(current) : []),
    ...undeterminedFindings(current),
    ...overheadFindings(current, references, gates),
    ...(exceptions === undefined
      ? []
      : complexityGainFindings({ ...exceptions, release, current })),
    ...environmentNotes(previous, current),
  ]
}
