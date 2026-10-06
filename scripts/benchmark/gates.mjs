// What a benchmark run is allowed to fail a pull request for -- and, as importantly, what it is not.
//
// Comparing wall-clock milliseconds measured on one runner with milliseconds measured on another, at
// another time (which is what "this PR against main's committed results" is), is not a defensible
// gate at any threshold: the same code swings 10-40% between runs, more for microsecond-scale work, and
// the two runs may not even be the same CPU or Node version. Raw cross-run deltas therefore stay
// highlights in the PR comment. What can gate is a property of ONE run, or a ratio between two quantities
// measured in the same run -- both survive a change of machine:
//
//   1. complexity     a function whose measured growth class is two or more classes away from the one
//                     documented for it (`agreement: "differs"`). The documented big-O is the
//                     expectation; the class is fitted from this run alone.
//   2. normalized overhead   the package's added time as a percentage of the bare baseline
//                     (`overheadPercent`, both sides measured in the same run), compared with the same
//                     figure from a reference run. A faster or slower machine moves numerator and
//                     denominator together, so the ratio holds. The reference is both the previous run
//                     on main and the results at the last release, so a series of small regressions
//                     cannot ratchet the previous run upward unnoticed.
//
// The thresholds are deliberately loose, because they have to clear run-to-run noise with margin:
// microsecond-scale work (a baseline under 1 ms) swings 30-40% with no change at all, so it is allowed
// to grow by 70% before a human is stopped; millisecond-scale work, which is steadier, by 50%. Either
// still catches the 2x-and-worse changes that mean an algorithmic or implementation mistake.

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
 * @property {"fail" | "note"} level - `fail` fails a gated run; `note` is information.
 * @property {"complexity" | "normalized-overhead" | "environment"} kind
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
  return { n: typical.n, baselineMs: typical.baselineMs, overheadPercent: typical.overheadPercent }
}

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
      message: `\`${group}\`: documented ${value.expectedNotation ?? value.expected}, measured ${value.notation ?? value.class} (exponent ${typeof value.exponent === "number" ? value.exponent.toFixed(2) : "n/a"}, R² ${typeof value.rSquared === "number" ? value.rSquared.toFixed(2) : "n/a"}). Either the code regressed or the documented big-O is wrong -- decide which and fix it.`,
    })
  }
  return findings
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
  for (const { name, results } of references) {
    const then = typicalOverhead(results)
    if (!then || !(then.overheadPercent > 0)) continue
    if (then.baselineMs < gates.noiseFloorBaselineMs) continue
    const increase = (now.overheadPercent / then.overheadPercent - 1) * 100
    if (increase > allowed) {
      findings.push({
        level: "fail",
        kind: "normalized-overhead",
        message: `Overhead relative to the baseline grew from ${then.overheadPercent.toFixed(1)}% (${name}) to ${now.overheadPercent.toFixed(1)}% -- up ${increase.toFixed(0)}%, over the ${String(allowed)}% allowed for work this fast. Both figures are same-run ratios, so this is not a slower machine.`,
      })
    }
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
 * @param {{ previous?: object | null, release?: object | null, current?: object, gates?: object }} input
 * @returns {Finding[]}
 */
export function evaluateGates({ previous, release, current, gates: overrides }) {
  const gates = resolveGates(overrides)
  return [
    ...(gates.complexity ? complexityFindings(current) : []),
    ...overheadFindings(
      current,
      [
        { name: "last run on main", results: previous },
        { name: "last release", results: release },
      ],
      gates,
    ),
    ...environmentNotes(previous, current),
  ]
}
