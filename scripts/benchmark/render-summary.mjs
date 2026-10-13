#!/usr/bin/env node
// Diffs a "previous" and "current" results.json for one or more named
// examples (env-cap/data-cap each have exactly two -- runtime and
// build-time -- but nothing here assumes that count), renders a single
// Markdown PR-comment summary. It leads with any complexity-shift flags (see
// classify-complexity.mjs) -- a change in a group's inferred Big-O shape,
// not just an ordinary "got somewhat slower." The table gives each function's big-O and how it moved;
// a raw time against another run is not shown, because it is not comparable between machines.
//
// What may FAIL a run is deliberately narrow (see gates.mjs): only properties of one run, or ratios
// between quantities measured in the same run -- a function whose measured growth class differs from
// its documented one, and the package's overhead as a percentage of the bare baseline growing past a
// threshold against the last run on main and the last release. A function whose big-O cannot be
// determined is a warning. Raw millisecond deltas between two runs on different machines are not
// shown. With `--gate` the script exits 1 when a gate fails;
// without it, it exits 0 and only renders.
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
//     --example 'Runtime (`benchmark/performance-runtime`)|<prev-results.json>|<cur-results.json>|<history.json>|<release-results.json>' \
//     [--example 'Build-time (...)|...|...|...|...' ...] [--gate]
//
// Each --example's fields are pipe-separated: label, previous results.json
// path (empty string for "no prior run," e.g. first-ever run), current
// results.json path (required), history.json path (empty string to skip
// complexity-shift detection for that example -- the ordinary table
// still renders), and optionally the results.json of the last release (a
// fixed reference, so a series of small regressions cannot ratchet the
// previous run upward unnoticed). Any missing/unreadable "previous" or
// "release" file is treated as "no prior data."

import path from "node:path"
import { pathToFileURL } from "node:url"
import { isDerivedGroup } from "./page-sections.mjs"
import { detectComplexityShift } from "./classify-complexity.mjs"
import { evaluateGates } from "./gates.mjs"
import { renderTrendTable, trendRows } from "./trend.mjs"
import {
  collectEntries,
  latestHistoryEntry,
  resultsToMeasurements,
  tryReadJson,
} from "./lib/results.mjs"

/**
 * @param {string[]} argv - the command-line arguments after the script name.
 * @returns {{ examples: string[], marker: string, budgetsPath?: string, exceptionsPath?: string, gate?: boolean, help?: boolean }}
 */
export function parseArgs(argv) {
  const args = { examples: [], marker: "<!-- benchmark-summary -->" }
  // An iterator, so a flag takes the next argument as its value without any index to advance.
  const items = argv[Symbol.iterator]()
  const value = () => items.next().value
  for (const arg of items) {
    if (arg === "--budgets") args.budgetsPath = value()
    else if (arg === "--marker") args.marker = value()
    else if (arg === "--exceptions") args.exceptionsPath = value()
    else if (arg === "--example") args.examples.push(value())
    else if (arg === "--gate") args.gate = true
    else if (arg === "--help" || arg === "-h") args.help = true
  }
  return args
}

function parseExample(spec) {
  const [label, prevPath, curPath, historyPath, releasePath] = spec.split("|")
  if (!label || !curPath) {
    throw new Error(
      `--example must be "label|prevResultsPath|curResultsPath|historyPath[|releaseResultsPath]" (prev/history/release may be empty); got: ${spec}`,
    )
  }
  return {
    label,
    prevPath: prevPath || undefined,
    curPath,
    historyPath: historyPath || undefined,
    releasePath: releasePath || undefined,
  }
}

/** Every group whose inferred complexity class differs from the latest history entry's. */
function complexityShifts(label, current, historyPath) {
  const previousEntry = latestHistoryEntry(tryReadJson(historyPath))
  if (!previousEntry) return []

  return Object.entries(resultsToMeasurements(current)).flatMap(([group, tiers]) => {
    // The overhead is a difference of two noisy medians, not a measurement: its shape is not a signal.
    if (isDerivedGroup(group)) return []
    const shift = detectComplexityShift(previousEntry.measurements?.[group], tiers)
    return shift.shifted ? [{ label, group, ...shift }] : []
  })
}

/** One example's section: anything that did not complete, then each function's big-O and how it moved. */
function renderExample(label, previous, current) {
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
      `> ⚠️ **Suite version mismatch**: previous run used \`s${previous.metadata.versions?.benchmarkSuiteVersion}\`, ` +
        `current run used \`s${current.metadata?.versions?.benchmarkSuiteVersion}\`. Numbers below are not directly comparable.`,
      "",
    )
  }

  const notCompleted = collectEntries(current).filter((e) => e.entry.status !== "completed")
  if (notCompleted.length > 0) {
    lines.push("**Failed / skipped:**", "")
    for (const { name, tier, entry } of notCompleted) {
      lines.push(
        `- \`${name}.${tier}\`: ${entry.status}${entry.reason ? ` (${entry.reason})` : ""}${entry.error ? ` (${entry.error.name}: ${entry.error.message})` : ""}`,
      )
    }
    lines.push("")
  }

  lines.push(...renderTrendTable(trendRows(current, previous)), "")

  return lines.join("\n")
}

/** @returns {Promise<object | undefined>} the package's `GATES`, when it has a file that exports them. */
async function loadGates(budgetsPath) {
  if (!budgetsPath) return undefined
  return (await import(pathToFileURL(path.resolve(budgetsPath)).href)).GATES
}

/**
 * Renders the summary and evaluates the gates.
 * @param {{ examples: string[], budgetsPath?: string, exceptionsPath?: string, marker: string, now?: Date }} input
 * @returns {Promise<{ markdown: string, failures: object[] }>} the Markdown, and every gate that failed.
 */
export async function summarize({
  examples,
  budgetsPath,
  exceptionsPath,
  marker,
  now = new Date(),
}) {
  const gates = await loadGates(budgetsPath)
  // Stryker disable next-line ArrayDeclaration: equivalent -- a stray element has no suite or group, so it matches no gain.
  const records = tryReadJson(exceptionsPath)?.exceptions ?? []

  const perExample = examples.map((spec) => {
    const { label, prevPath, curPath, historyPath, releasePath } = parseExample(spec)
    const previous = tryReadJson(prevPath)
    const current = tryReadJson(curPath)
    const release = tryReadJson(releasePath)
    return {
      shifts: complexityShifts(label, current ?? {}, historyPath),
      section: renderExample(label, previous, current),
      // With no current results there is nothing to judge: every gate returns no findings.
      findings: evaluateGates({
        previous,
        release,
        current,
        gates,
        exceptions: { suite: path.basename(path.dirname(curPath)), records, now },
      }).map((finding) => ({
        ...finding,
        label,
      })),
    }
  })
  const allShifts = perExample.flatMap((example) => example.shifts)
  const sections = perExample.map((example) => example.section)
  const findings = perExample.flatMap((example) => example.findings)
  const failures = findings.filter((finding) => finding.level === "fail")
  const warnings = findings.filter((finding) => finding.level === "warn")
  const notes = findings.filter((finding) => finding.level === "note")

  const lines = [marker, "", "# Benchmark summary", ""]

  // Complexity shifts lead, ahead of the ordinary per-example tables and
  // their own tables -- a shift in a group's inferred
  // algorithmic shape is a structurally different (and rarer, and more
  // serious) signal than "this run was somewhat slower," so it's surfaced
  // first regardless of which example it came from.
  if (allShifts.length > 0) {
    lines.push("## ⚠️ Complexity shifts", "")
    lines.push(
      "The inferred algorithmic complexity class of at least one benchmark group changed since the last recorded history entry. This is a stronger signal than an ordinary slowdown below -- it means the shape of the cost curve changed, not just its slope.",
      "",
    )
    for (const shift of allShifts) {
      lines.push(
        `- 🔺 **${shift.label} / \`${shift.group}\`**: \`${shift.previousClass}\` → \`${shift.currentClass}\``,
      )
    }
    lines.push("")
  }

  lines.push(
    failures.length > 0
      ? `## ❌ ${String(failures.length)} gate${failures.length === 1 ? "" : "s"} failed`
      : warnings.length > 0
        ? `## ⚠️ Gates passed, ${String(warnings.length)} warning${warnings.length === 1 ? "" : "s"}`
        : "## ✅ Gates passed",
    "",
    "Three things can fail a benchmark run, because only they are properties of a single run or ratios measured within it, or a decision a human must make, so they depend far less on the machine than a raw time does: a function whose measured growth class differs from its documented big-O, the package's overhead relative to its bare baseline growing past a threshold against the last run on main and the last release, and a function whose growth class got worse than at the last release without a recorded exception. A function whose big-O could not be determined is a warning, because nothing is known to be wrong. A raw time is never compared between runs, because runs on different machines are not comparable.",
    "",
    ...failures.map((finding) => `- ❌ **${finding.label}** — ${finding.message}`),
    ...warnings.map((finding) => `- ⚠️ **${finding.label}** — ${finding.message}`),
    ...notes.map((finding) => `- ℹ️ **${finding.label}** — ${finding.message}`),
    ...(failures.length + warnings.length + notes.length > 0 ? [""] : []),
    ...sections,
  )

  return { markdown: lines.join("\n"), failures }
}

/**
 * @param {{ examples: string[], budgetsPath?: string, marker: string }} input
 * @returns {Promise<string>} just the Markdown.
 */
export async function renderSummary(input) {
  return (await summarize(input)).markdown
}

/**
 * Runs the command: renders the summary, writes it and, only under `--gate`, turns a failed gate into a failure.
 * @param {string[]} argv - the command-line arguments after the script name.
 * @param {{ out: (text: string) => void, error: (text: string) => void }} io - where output goes.
 * @returns {Promise<number>} the process exit code.
 */
export async function run(argv, io) {
  const args = parseArgs(argv)
  if (args.help || args.examples.length === 0) {
    io.error(
      "Usage: node render-summary.mjs --budgets <budgets.mjs> [--marker <marker>] [--exceptions <registry.json>] [--gate] --example 'label|prev|cur|history[|release]' [--example ...]",
    )
    return args.help ? 0 : 1
  }

  const { markdown, failures } = await summarize(args)
  io.out(markdown + "\n")
  // The comment is always written; only an explicit --gate turns a failed gate into a failed run.
  return args.gate && failures.length > 0 ? 1 : 0
}

// The process entry point: hands argv to `run` (tested in-process) and turns its result into an exit
// code. Its test spawns the script, which coverage cannot attribute to this file.
// Stryker disable BlockStatement, ConditionalExpression, CallExpression, StringLiteral, ArrowFunction, MethodExpression, ObjectLiteral: process entry point, exercised only by spawning the script
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  run(process.argv.slice(2), {
    out: (text) => process.stdout.write(text),
    error: (text) => console.error(text),
  })
    .then((code) => {
      process.exitCode = code
    })
    .catch((err) => {
      console.error(err)
      process.exitCode = 1
    })
}
// Stryker restore BlockStatement, ConditionalExpression, CallExpression, StringLiteral, ArrowFunction, MethodExpression, ObjectLiteral
