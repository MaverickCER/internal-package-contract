// `verify-consumers --compare`: does a consumer get the same verdict, check by check, from this standard as from
// the one it has installed? The regression mode forgives a check that got better. An equivalence run must not:
// a check that suddenly passes may have stopped looking. So every verdict change is reported, and only the
// differences a recorded decision explains are allowed.

/**
 * @typedef {{ outcome: string, rationale: string }} Verdict
 * @typedef {{ id: string, before: string, after: string, status: "same" | "reworded" | "allowed" | "changed", reason?: string, rationale?: string }} ComparisonRow
 * @typedef {{ ids: readonly string[] | "*", from: string, to: string, rationale?: RegExp, reason: string }} AllowedDifference
 */

/** The library-only checks repo-contract's tiers pass as not applicable on a `private: true` package. */
const LIBRARY_CHECKS = ["Packaging", "TypeResolution", "BundledDependencies", "QuickStart"]

/**
 * Verdict changes a decision of the preset redesign explains. Everything else that changes is a finding.
 * @type {readonly AllowedDifference[]}
 */
export const ALLOWED_DIFFERENCES = [
  {
    ids: LIBRARY_CHECKS,
    from: "fail",
    to: "pass",
    rationale: /is not applicable: package\.json sets "private": true/,
    reason:
      "The owner decided that a library-only check passes as not applicable on a private package.",
  },
  {
    ids: "*",
    from: "absent",
    to: "pass",
    reason: "The check is new in this standard, and it passes.",
  },
]

/** The verdict of a check one side does not have. Its rationale is never read: a row takes the other side's. */
const ABSENT = /** @type {Verdict} */ ({ outcome: "absent" })

/**
 * @param {string} id - the check.
 * @param {string} before - its outcome with the installed standard, or `absent`.
 * @param {Verdict} after - its verdict with this standard, or {@link ABSENT}.
 * @returns {AllowedDifference | undefined} the decision that explains the change, if one does.
 */
function allowance(id, before, after) {
  return ALLOWED_DIFFERENCES.find(
    (difference) =>
      (difference.ids === "*" || difference.ids.includes(id)) &&
      difference.from === before &&
      difference.to === after.outcome &&
      (difference.rationale === undefined || difference.rationale.test(after.rationale)),
  )
}

/**
 * @param {Map<string, Verdict>} before - each check's verdict with the installed standard.
 * @param {Map<string, Verdict>} after - each check's verdict with this standard.
 * @returns {ComparisonRow[]} one row per check: this standard's checks in order, then the ones only the
 *   installed standard had.
 */
export function compareVerdicts(before, after) {
  const ids = [...after.keys(), ...[...before.keys()].filter((id) => !after.has(id))]
  return ids.map((id) => {
    const was = before.get(id) ?? ABSENT
    const now = after.get(id) ?? ABSENT
    const row = { id, before: was.outcome, after: now.outcome }
    if (row.before === row.after) {
      return { ...row, status: was.rationale === now.rationale ? "same" : "reworded" }
    }
    const allowed = allowance(id, row.before, now)
    if (allowed !== undefined) return { ...row, status: "allowed", reason: allowed.reason }
    return { ...row, status: "changed", rationale: now === ABSENT ? was.rationale : now.rationale }
  })
}

/**
 * @param {readonly ComparisonRow[]} rows - from {@link compareVerdicts}.
 * @returns {string} a Markdown table, one row per check.
 */
export function renderComparison(rows) {
  const lines = [
    "| Check | Installed standard | This standard | Verdict |",
    "| --- | --- | --- | --- |",
    ...rows.map(
      ({ id, before, after, status, reason }) =>
        `| ${id} | ${before} | ${after} | ${reason === undefined ? status : `${status}: ${reason}`} |`,
    ),
  ]
  return `${lines.join("\n")}\n`
}
