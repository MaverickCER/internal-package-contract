// What the pull-request summary says about each function: its big-O now, and whether that is the same as, worse
// than or better than at the last run, or why that cannot be said. Pure: it reads the `analysis.complexity` of two
// results.json files, which hold one entry per measured group.

import { COMPLEXITY_CLASSES } from "./classify-complexity.mjs"
import { parseGroup } from "./kit/define.mjs"

/**
 * @param {string} group - a benchmark group name.
 * @param {string | undefined} [variable] - the variable it varies.
 * @returns {{ name: string, variable: string }} how a reader sees the group: the function (and variant), and what is varied.
 */
export function describeGroup(group, variable) {
  const parts = parseGroup(group)
  if (parts === undefined) return { name: group, variable: variable ?? "—" }
  return {
    name: parts.variant === undefined ? parts.id : `${parts.id} (${parts.variant})`,
    variable: variable ?? parts.variable ?? "—",
  }
}

/**
 * @param {{ class?: string | null, notation?: string | null } | undefined} now - this run's entry for the group.
 * @param {{ class?: string | null, notation?: string | null } | undefined} before - the last run's, if it had one.
 * @param {boolean} hadPrevious - whether there was a previous run to compare with at all.
 * @returns {string} `same`, `worse (O(n) → O(n²))`, `improved (...)`, or `N/A` and the reason.
 */
export function trendOf(now, before, hadPrevious) {
  if (now?.class === null || now?.class === undefined) {
    return "N/A (this run could not determine it)"
  }
  if (!hadPrevious) return "N/A (no previous run)"
  if (before === undefined) return "N/A (not measured in the previous run)"
  if (before.class === null || before.class === undefined) {
    return "N/A (the previous run could not determine it)"
  }
  const change = COMPLEXITY_CLASSES.indexOf(now.class) - COMPLEXITY_CLASSES.indexOf(before.class)
  const verdict = ["improved", "same", "worse"][Math.sign(change) + 1]
  return change === 0 ? verdict : `${verdict} (${before.notation} → ${now.notation})`
}

/**
 * @param {object | null | undefined} current - this run's results.json.
 * @param {object | null | undefined} previous - the last run's, or `{}` / nothing on a first run.
 * @returns {{ name: string, variable: string, bigO: string, trend: string }[]} one row per measured group, in the order measured.
 */
export function trendRows(current, previous) {
  const before = previous?.analysis?.complexity
  return Object.entries(current?.analysis?.complexity ?? {}).map(([group, value]) => ({
    ...describeGroup(group, value?.variable),
    bigO: value?.notation ?? "undetermined",
    trend: trendOf(value, before?.[group], before !== undefined),
  }))
}

/**
 * @param {{ name: string, variable: string, bigO: string, trend: string }[]} rows
 * @returns {string[]} the Markdown table's lines.
 */
export function renderTrendTable(rows) {
  return [
    "| Function | Variable | Big-O | Since the last run |",
    "|---|---|---|---|",
    ...rows.map((row) => `| \`${row.name}\` | ${row.variable} | ${row.bigO} | ${row.trend} |`),
  ]
}
