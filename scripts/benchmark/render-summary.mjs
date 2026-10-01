#!/usr/bin/env node
// Diffs a "previous" and "current" results.json for one or more named
// examples (env-cap/data-cap each have exactly two -- runtime and
// build-time -- but nothing here assumes that count), renders a single
// Markdown PR-comment summary. Highlights entries that exceed their own
// budgets.mjs threshold, and leads with any complexity-shift flags (see
// classify-complexity.mjs) -- a change in a group's inferred Big-O shape,
// not just an ordinary "got somewhat slower." Never gates, never fails: this
// script always exits 0, it renders findings for a human (or a PR comment)
// to read.
//
// Generalizes env-cap's scripts/render-benchmark-summary.mjs and data-cap's
// benchmarks/render-benchmark-summary.mjs (near-identical; this reconciles
// the one real difference -- data-cap's `previous?.metadata` guard against a
// first-run `{}` "previous" is strictly more correct than env-cap's bare
// `previous &&`, since `{}` is truthy but has no real metadata to compare --
// by adopting data-cap's version everywhere).
//
// Usage:
//   node render-summary.mjs \
//     --budgets <path/to/budgets.mjs> \
//     --marker '<!-- my-benchmark-summary -->' \
//     --example 'Runtime (`benchmark/performance-runtime`)|<prev-results.json>|<cur-results.json>|<history.json>' \
//     [--example 'Build-time (...)|...|...|...' ...]
//
// Each --example's fields are pipe-separated: label, previous results.json
// path (empty string for "no prior run," e.g. first-ever run), current
// results.json path (required), history.json path (empty string to skip
// complexity-shift detection for that example -- the ordinary budget table
// still renders). Any missing/unreadable "previous" file is treated as "no
// prior data," same as before.

import path from "node:path"
import { pathToFileURL } from "node:url"
import { detectComplexityShift } from "./classify-complexity.mjs"
import { collectEntries, primaryMedianMs, latestHistoryEntry, tryReadJson } from "./lib/results.mjs"

function parseArgs(argv) {
  const args = { examples: [], marker: "<!-- benchmark-summary -->" }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--budgets") args.budgetsPath = argv[++i]
    else if (arg === "--marker") args.marker = argv[++i]
    else if (arg === "--example") args.examples.push(argv[++i])
    else if (arg === "--help" || arg === "-h") args.help = true
  }
  return args
}

function parseExample(spec) {
  const [label, prevPath, curPath, historyPath] = spec.split("|")
  if (!label || !curPath) {
    throw new Error(
      `--example must be "label|prevResultsPath|curResultsPath|historyPath" (prev/history may be empty); got: ${spec}`,
    )
  }
  return { label, prevPath: prevPath || undefined, curPath, historyPath: historyPath || undefined }
}

function renderComplexityShifts(label, current, historyPath) {
  if (!historyPath) return { lines: [], shifts: [] }
  const history = tryReadJson(historyPath)
  const previousEntry = latestHistoryEntry(history)
  if (!previousEntry) return { lines: [], shifts: [] }

  const currentGroups = {}
  for (const { name, tier, entry } of collectEntries(current)) {
    if (entry.status !== "completed") continue
    const medianMs = primaryMedianMs(entry)
    if (medianMs === undefined) continue
    currentGroups[name] = currentGroups[name] ?? {}
    currentGroups[name][tier] = { medianMs, inputs: entry.inputs }
  }

  const shifts = []
  for (const [group, tiers] of Object.entries(currentGroups)) {
    const previousTiers = previousEntry.measurements?.[group]
    if (!previousTiers) continue
    const shift = detectComplexityShift(previousTiers, tiers)
    if (shift.shifted) shifts.push({ label, group, ...shift })
  }
  return { shifts }
}

/** Finds the first `medianMs`-bearing field on an entry, for a simple regression-percent story. Not every benchmark shape has one -- those are reported without a percent. */
function renderExample(label, previous, current, budgets) {
  const lines = [`## ${label}`, ""]

  if (!current) {
    lines.push("_No current results found._", "")
    return lines.join("\n")
  }

  // `previous` is `{}` (truthy, no real metadata) on a first-ever run (see
  // CI's `git show ... || echo '{}'` fallback), never `null` -- guarded on
  // `previous?.metadata` being present, not just `previous` being truthy, so
  // a first run reports "no prior data" instead of a confusing "previous run
  // used sundefined" mismatch warning.
  if (
    previous?.metadata &&
    previous.metadata.versions?.benchmarkSuiteVersion !==
      current.metadata?.versions?.benchmarkSuiteVersion
  ) {
    lines.push(
      `> ⚠️ **Suite version mismatch**: previous run used \`s${previous.metadata?.versions?.benchmarkSuiteVersion}\`, ` +
        `current run used \`s${current.metadata?.versions?.benchmarkSuiteVersion}\`. Numbers below are not directly comparable.`,
      "",
    )
  }

  const currentEntries = collectEntries(current)
  const previousByKey = new Map(
    collectEntries(previous ?? {}).map((e) => [`${e.name}.${e.tier}`, e.entry]),
  )

  const notCompleted = currentEntries.filter((e) => e.entry.status !== "completed")
  if (notCompleted.length > 0) {
    lines.push("**Failed / skipped:**", "")
    for (const { name, tier, entry } of notCompleted) {
      lines.push(
        `- \`${name}.${tier}\`: ${entry.status}${entry.reason ? ` (${entry.reason})` : ""}${entry.error ? ` (${entry.error.name}: ${entry.error.message})` : ""}`,
      )
    }
    lines.push("")
  }

  lines.push("| Benchmark | Tier | Median | Change | Budget |", "|---|---|---|---|---|")
  const highlights = []
  for (const { name, tier, entry } of currentEntries) {
    if (entry.status !== "completed") continue
    const medianMs = primaryMedianMs(entry)
    const previousEntry = previousByKey.get(`${name}.${tier}`)
    const previousMedianMs =
      previousEntry && previousEntry.status === "completed"
        ? primaryMedianMs(previousEntry)
        : undefined

    let changeCell = "—"
    let changePercent
    if (medianMs !== undefined && previousMedianMs !== undefined && previousMedianMs > 0) {
      changePercent = ((medianMs - previousMedianMs) / previousMedianMs) * 100
      changeCell = `${changePercent >= 0 ? "+" : ""}${changePercent.toFixed(1)}%`
    }

    // A group with no entry of its own falls back to the "*" default, so a suite whose groups are
    // generated (one per function and variant) needs no per-group list.
    const budget = budgets[name] ?? budgets["*"]
    const budgetCell = budget ? `${budget.maxRegressionPercent}%` : "(unbudgeted)"
    if (budget && changePercent !== undefined && changePercent > budget.maxRegressionPercent) {
      highlights.push({ name, tier, changePercent, budget: budget.maxRegressionPercent })
    }

    lines.push(
      `| \`${name}\` | ${tier} | ${medianMs !== undefined ? medianMs.toFixed(2) + "ms" : "—"} | ${changeCell} | ${budgetCell} |`,
    )
  }
  lines.push("")

  if (highlights.length > 0) {
    lines.push("**Exceeds budget:**", "")
    for (const h of highlights) {
      lines.push(
        `- ⚠️ \`${h.name}.${h.tier}\` +${h.changePercent.toFixed(1)}% (budget: ${h.budget}%) — human review suggested.`,
      )
    }
    lines.push("")
  }

  return lines.join("\n")
}

async function loadBudgets(budgetsPath) {
  if (!budgetsPath) return {}
  const mod = await import(pathToFileURL(path.resolve(budgetsPath)).href)
  return mod.BUDGETS ?? {}
}

export async function renderSummary({ examples, budgetsPath, marker }) {
  const budgets = await loadBudgets(budgetsPath)

  const allShifts = []
  const sections = []
  for (const spec of examples) {
    const { label, prevPath, curPath, historyPath } = parseExample(spec)
    const previous = tryReadJson(prevPath)
    const current = tryReadJson(curPath)
    const { shifts } = renderComplexityShifts(label, current ?? {}, historyPath)
    allShifts.push(...shifts)
    sections.push(renderExample(label, previous, current, budgets))
  }

  const lines = [marker, "", "# Benchmark summary", ""]

  // Complexity shifts lead, ahead of the ordinary per-example tables and
  // their own "Exceeds budget" call-outs -- a shift in a group's inferred
  // algorithmic shape is a structurally different (and rarer, and more
  // serious) signal than "this run was somewhat slower," so it's surfaced
  // first regardless of which example it came from.
  if (allShifts.length > 0) {
    lines.push("## ⚠️ Complexity shifts", "")
    lines.push(
      "The inferred algorithmic complexity class of at least one benchmark group changed since the last recorded history entry. This is a stronger signal than an ordinary budget breach below -- it means the shape of the cost curve changed, not just its slope.",
      "",
    )
    for (const shift of allShifts) {
      lines.push(
        `- 🔺 **${shift.label} / \`${shift.group}\`**: \`${shift.previousClass}\` → \`${shift.currentClass}\``,
      )
    }
    lines.push("")
  }

  lines.push("Highlight-only -- nothing here gates a merge.", "", ...sections)

  return lines.join("\n")
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help || args.examples.length === 0) {
    console.error(
      "Usage: node render-summary.mjs --budgets <budgets.mjs> [--marker <marker>] --example 'label|prev|cur|history' [--example ...]",
    )
    process.exitCode = args.help ? 0 : 1
    return
  }

  const output = await renderSummary(args)
  process.stdout.write(output + "\n")
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  main().catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
}
