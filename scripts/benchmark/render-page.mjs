#!/usr/bin/env node
// Builds a static `docs/benchmarks/index.html` page from one or more
// consumer-owned history JSON files -- small-multiples line charts, one per
// named benchmark group, tiers as categorical-colored series within each
// chart, annotated with the group's currently-inferred complexity class
// (see classify-complexity.mjs). Generated fresh by a consumer's own
// `deploy` job right before the Pages artifact upload (see this package's
// .github/workflows/benchmark-pr.yml doc comment) -- never committed, same
// treatment `docs/api/` already gets in this fleet.
//
// Design follows the `dataviz` skill's procedure: line form for
// change-over-time, categorical color assigned in the documented fixed
// slot order (never cycled), 2px lines with >=8px end markers, hairline
// recessive gridlines, an always-present legend (>=2 series per chart),
// dark mode selected via both `prefers-color-scheme` and a `data-theme` scope, using the skill's own
// validated default palette (references/palette.md).
//
// The page is rendered entirely on the server and needs no script. Each chart is an SVG with an
// accessible name and a generated description, its series are told apart by dash pattern and a direct
// label as well as colour, and every figure is also a table (with the commit, pull request and version
// of each run). A hover tooltip is deliberately absent: it reached only mouse users.
//
// Usage:
//   node render-page.mjs \
//     --out docs/benchmarks/index.html \
//     --history 'Runtime|docs/benchmark-history/runtime.json' \
//     [--history 'Build-time|docs/benchmark-history/buildtime.json' ...] \
//     [--max-entries 200]

import fs from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { classifyGroup } from "./classify-complexity.mjs"
import { readJson } from "./lib/results.mjs"

const DEFAULT_MAX_ENTRIES = 200

// The skill's reference categorical palette (references/palette.md), fixed
// slot order -- never reordered or regenerated per page. Only the first 4-5
// slots are ever realistically needed (env-cap's/data-cap's own tier ladders
// top out at 4 tier names), which keeps every chart inside the
// all-pairs-safe zone the palette doc calls out for small multiples (its
// first 3 slots validate all-pairs cleanly in both modes; a realistic 4th
// tier name like "enterprise"/"fixed" uses slot 4 with that documented
// caveat).
const CATEGORICAL_SLOTS = [
  { light: "#2a78d6", dark: "#3987e5" }, // 1 blue
  { light: "#eb6834", dark: "#d95926" }, // 2 orange
  { light: "#1baf7a", dark: "#199e70" }, // 3 aqua
  { light: "#eda100", dark: "#c98500" }, // 4 yellow
  { light: "#e87ba4", dark: "#d55181" }, // 5 magenta
  { light: "#008300", dark: "#008300" }, // 6 green
  { light: "#4a3aa7", dark: "#9085e9" }, // 7 violet
  { light: "#e34948", dark: "#e66767" }, // 8 red
]

// Tier names seen across env-cap and data-cap's own tier ladders, in a
// preferred display order -- purely cosmetic (first-seen order would work
// too), keeps baseline/stress/extreme first and consistent on every page
// regardless of which group happens to declare them first.
const PREFERRED_TIER_ORDER = ["baseline", "stress", "extreme", "enterprise", "fixed"]

/**
 * @param {string[]} argv - the command-line arguments after the script name.
 * @returns {{ histories: string[], maxEntries: number, out?: string, readme?: string, repo?: string, help?: boolean }}
 */
export function parseArgs(argv) {
  const args = { histories: [], maxEntries: DEFAULT_MAX_ENTRIES }
  // An iterator, so a flag takes the next argument as its value without any index to advance.
  const items = argv[Symbol.iterator]()
  const value = () => items.next().value
  for (const arg of items) {
    if (arg === "--out") args.out = value()
    else if (arg === "--history") args.histories.push(value())
    else if (arg === "--max-entries") args.maxEntries = Number(value())
    else if (arg === "--readme") args.readme = value()
    else if (arg === "--repo") args.repo = value()
    else if (arg === "--help" || arg === "-h") args.help = true
  }
  return args
}

function parseHistorySpec(spec) {
  const [label, historyPath] = spec.split("|")
  if (!label || !historyPath) {
    throw new Error(`--history must be "label|path/to/history.json"; got: ${spec}`)
  }
  return { label, historyPath }
}

/** All tier names appearing anywhere in `entries`, ordered by PREFERRED_TIER_ORDER first, then first-seen order for anything else. */
function discoverTiers(entries) {
  const seen = new Set()
  for (const entry of entries) {
    for (const tiers of Object.values(entry.measurements ?? {})) {
      for (const tier of Object.keys(tiers)) seen.add(tier)
    }
  }
  const preferred = PREFERRED_TIER_ORDER.filter((t) => seen.has(t))
  const rest = [...seen].filter((t) => !preferred.includes(t)).sort()
  return [...preferred, ...rest]
}

/** All group (named-benchmark) names appearing anywhere in `entries`. */
function discoverGroups(entries) {
  const seen = new Set()
  for (const entry of entries) {
    for (const group of Object.keys(entry.measurements ?? {})) seen.add(group)
  }
  return [...seen].sort()
}

/**
 * Builds one group's chart data: an index-aligned series per tier (using
 * entry position, not wall-clock spacing, as the x-axis -- CI runs aren't
 * evenly time-spaced, and "run N of the most recent window" reads cleanly
 * without implying a timing precision the data doesn't have), plus the
 * currently-inferred complexity class from the LATEST entry that has this
 * group at all.
 */
function buildGroupData(group, entries, tierOrder) {
  const series = tierOrder.map((tier) => ({
    tier,
    points: entries.map((entry, index) => {
      const measurement = entry.measurements?.[group]?.[tier]
      return measurement ? { index, medianMs: measurement.medianMs } : null
    }),
  }))

  // A group is only discovered from an entry that measured it, so there is always one.
  const latest = entries.findLast((entry) => entry.measurements?.[group])
  return { group, series, ...classifyGroup(latest.measurements[group]) }
}

/** The version of the package an entry was measured at: the first recorded version that is not the suite's own. */
function entryVersion(entry) {
  for (const [key, value] of Object.entries(entry.versions ?? {})) {
    if (key !== "benchmarkSuiteVersion" && typeof value === "string") return value
  }
  return null
}

export async function buildPageModel({ histories, maxEntries, readme, repo }) {
  const categories = []
  for (const spec of histories) {
    const { label, historyPath } = parseHistorySpec(spec)
    const history = readJson(historyPath)
    const allEntries = Array.isArray(history.entries) ? history.entries : []
    const entries = allEntries.slice(-maxEntries)
    const tierOrder = discoverTiers(entries)
    const groups = discoverGroups(entries).map((group) => buildGroupData(group, entries, tierOrder))
    categories.push({
      label,
      tierOrder,
      entryCount: entries.length,
      totalEntryCount: allEntries.length,
      timestamps: entries.map((e) => e.timestamp ?? null),
      // What a reader needs to ask "which change moved this": when, at which commit and pull request,
      // and at which version of the package.
      runs: entries.map((e) => ({
        timestamp: e.timestamp ?? null,
        commit: typeof e.gitCommit === "string" ? e.gitCommit : null,
        pullRequest: Number.isInteger(e.pullRequest) ? e.pullRequest : null,
        version: entryVersion(e),
      })),
      groups,
    })
  }
  return {
    generatedAt: new Date().toISOString(),
    maxEntries,
    categories,
    readmeUrl: readme,
    repoUrl: repo,
  }
}

/** Escapes text for use in HTML element content or a double-quoted attribute. */
export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}

/** @param {number} ms @returns {string} */
export function formatMs(ms) {
  if (ms < 0.001) return `${(ms * 1000).toFixed(2)} µs`
  if (ms < 1) return `${ms.toFixed(3)} ms`
  return `${ms.toFixed(ms < 100 ? 2 : 1)} ms`
}

/** @param {string | null} iso @returns {string} the date part, or an en dash. */
function dateOf(iso) {
  return iso ? String(iso).slice(0, 10) : "–"
}

/**
 * The run's label for people: its version when known, else its date.
 * @param {{ timestamp: string | null, version: string | null }} run
 * @param {number} index
 */
function runLabel(run, index) {
  return `${run.version ? `v${run.version}` : `run ${String(index + 1)}`}, ${dateOf(run.timestamp)}`
}

/**
 * A sentence that says what a chart shows, for a reader who cannot see it.
 * @param {object} group - one group's chart data.
 * @param {object[]} runs - the category's runs, aligned with every series' points.
 * @returns {string}
 */
export function describeGroup(group, runs) {
  const parts = []
  for (const series of group.series) {
    const present = series.points.filter(Boolean)
    if (present.length === 0) continue
    const first = present[0]
    const last = present[present.length - 1]
    parts.push(
      `${series.tier}: ${formatMs(first.medianMs)} → ${formatMs(last.medianMs)} over ${String(present.length)} run${present.length === 1 ? "" : "s"}`,
    )
  }
  const span =
    runs.length > 0
      ? ` From ${runLabel(runs[0], 0)} to ${runLabel(runs[runs.length - 1], runs.length - 1)}.`
      : ""
  const klass = group.complexityClass
    ? `Inferred complexity ${group.complexityClass}.`
    : "Inferred complexity unavailable."
  return `${parts.join("; ")}.${span} ${klass}`
}

const WIDTH = 300
const HEIGHT = 150
const PAD = { left: 38, right: 54, top: 8, bottom: 20 }
/** Line dashes per series slot, so tiers differ by more than colour. */
const DASHES = ["none", "6 3", "2 3", "8 3 2 3", "none", "6 3", "2 3", "8 3 2 3"]

/**
 * One group's chart as a standalone SVG string: named for assistive technology, each series labelled
 * directly at its last point, and distinguished by dash pattern as well as colour.
 * @param {object} group
 * @param {string[]} tierOrder
 * @param {Record<string, number>} tierColorIndex
 * @param {object[]} runs
 * @param {string} idPrefix - unique per chart, for the title/description ids.
 * @returns {string}
 */
export function renderChartSvg(group, tierOrder, tierColorIndex, runs, idPrefix) {
  const allPoints = group.series.flatMap((s) => s.points.filter(Boolean))
  if (allPoints.length === 0) return ""
  const plotW = WIDTH - PAD.left - PAD.right
  const plotH = HEIGHT - PAD.top - PAD.bottom
  const maxIndex = Math.max(...allPoints.map((p) => p.index))
  const maxY = Math.max(...allPoints.map((p) => p.medianMs)) * 1.08 || 1
  const x = (i) => PAD.left + (maxIndex === 0 ? plotW / 2 : (i / maxIndex) * plotW)
  const y = (v) => PAD.top + plotH - (v / maxY) * plotH

  const parts = [
    `<svg class="chart" role="img" aria-labelledby="${idPrefix}-t ${idPrefix}-d" viewBox="0 0 ${String(WIDTH)} ${String(HEIGHT)}">`,
    `<title id="${idPrefix}-t">${escapeHtml(group.group)}: median time per run</title>`,
    `<desc id="${idPrefix}-d">${escapeHtml(describeGroup(group, runs))}</desc>`,
  ]
  for (const g of [0, 1, 2]) {
    const gy = PAD.top + (plotH / 2) * g
    parts.push(
      `<line class="gridline" x1="${String(PAD.left)}" x2="${String(WIDTH - PAD.right)}" y1="${gy.toFixed(1)}" y2="${gy.toFixed(1)}"/>`,
      `<text class="axis-label" x="2" y="${(gy + 3).toFixed(1)}">${escapeHtml(formatMs(maxY * (1 - g / 2)))}</text>`,
    )
  }
  const baseY = HEIGHT - PAD.bottom
  parts.push(
    `<line class="axis" x1="${String(PAD.left)}" x2="${String(WIDTH - PAD.right)}" y1="${String(baseY)}" y2="${String(baseY)}"/>`,
    `<text class="axis-label" x="${String(PAD.left)}" y="${String(HEIGHT - 6)}">${escapeHtml(runs[0] ? runLabel(runs[0], 0) : "first run")}</text>`,
    `<text class="axis-label" x="${String(WIDTH - PAD.right)}" y="${String(HEIGHT - 6)}" text-anchor="end">${escapeHtml(runs.length > 0 ? runLabel(runs[runs.length - 1], runs.length - 1) : "latest run")}</text>`,
  )
  const used = []
  for (const tier of tierOrder) {
    const series = group.series.find((s) => s.tier === tier)
    const segments = []
    let current = []
    for (const point of series.points) {
      if (point) current.push(point)
      else if (current.length) {
        segments.push(current)
        current = []
      }
    }
    if (current.length) segments.push(current)
    if (segments.length === 0) continue
    const slot = tierColorIndex[tier] ?? 0
    for (const segment of segments) {
      const d = segment
        .map((p, i) => `${i === 0 ? "M" : "L"}${x(p.index).toFixed(1)} ${y(p.medianMs).toFixed(1)}`)
        .join(" ")
      parts.push(
        `<path class="series-line s${String(slot + 1)}" d="${d}" stroke-dasharray="${DASHES[slot % DASHES.length]}"/>`,
      )
    }
    const lastSegment = segments[segments.length - 1]
    const end = lastSegment[lastSegment.length - 1]
    used.push({ tier, slot, end })
  }
  // Direct labels at the end of each line, nudged apart when two ends are close.
  used.sort((a, b) => y(a.end.medianMs) - y(b.end.medianMs))
  let lastLabelY = -Infinity
  for (const { tier, slot, end } of used) {
    const cy = y(end.medianMs)
    const labelY = Math.max(cy + 3, lastLabelY + 10)
    lastLabelY = labelY
    parts.push(
      `<circle class="series-dot s${String(slot + 1)}" cx="${x(end.index).toFixed(1)}" cy="${cy.toFixed(1)}" r="3.5"/>`,
      `<text class="series-label" x="${(x(end.index) + 7).toFixed(1)}" y="${labelY.toFixed(1)}">${escapeHtml(tier)}</text>`,
    )
  }
  parts.push("</svg>")
  return parts.join("")
}

/**
 * The same data as a table: every figure a chart shows, readable by keyboard, screen reader or
 * spreadsheet, with the commit, pull request and version each run belongs to.
 * @param {object} group
 * @param {string[]} tierOrder
 * @param {object[]} runs
 * @param {string | undefined} repoUrl - a GitHub repository URL, to link commits and pull requests.
 * @returns {string}
 */
export function renderDataTable(group, tierOrder, runs, repoUrl) {
  const tiers = tierOrder.filter((tier) => group.series.some((s) => s.tier === tier))
  const link = (text, href) =>
    repoUrl ? `<a href="${escapeHtml(repoUrl)}${href}">${escapeHtml(text)}</a>` : escapeHtml(text)
  const head = `<tr><th scope="col">Run</th><th scope="col">Date</th><th scope="col">Version</th><th scope="col">Commit</th><th scope="col">PR</th>${tiers.map((t) => `<th scope="col">${escapeHtml(t)} (median)</th>`).join("")}</tr>`
  const rows = runs.map((run, index) => {
    const cells = tiers.map((tier) => {
      const point = group.series.find((s) => s.tier === tier).points[index]
      return `<td>${point ? escapeHtml(formatMs(point.medianMs)) : "–"}</td>`
    })
    return `<tr><th scope="row">${String(index + 1)}</th><td>${escapeHtml(dateOf(run.timestamp))}</td><td>${run.version ? escapeHtml(run.version) : "–"}</td><td>${run.commit ? link(run.commit.slice(0, 7), `/commit/${run.commit}`) : "–"}</td><td>${run.pullRequest ? link(`#${String(run.pullRequest)}`, `/pull/${String(run.pullRequest)}`) : "–"}</td>${cells.join("")}</tr>`
  })
  return `<details class="data"><summary>Data table for ${escapeHtml(group.group)}</summary><table><caption>${escapeHtml(group.group)}: median time per recorded run</caption><thead>${head}</thead><tbody>${rows.join("")}</tbody></table></details>`
}

function badgeText(g) {
  if (g.complexityClass) {
    const fit = typeof g.rSquared === "number" ? ` (R² ${g.rSquared.toFixed(2)})` : ""
    return `Inferred complexity: ${g.complexityClass}${fit}`
  }
  if (g.reason === "no-size-variation")
    return "Inferred complexity: unavailable (no size variation across tiers)"
  if (g.reason === "poor-fit")
    return "Inferred complexity: unavailable (the cost does not follow a power law across the largest sizes)"
  return "Inferred complexity: unavailable (fewer than 2 tiers with recorded inputs)"
}

/** @param {object} model @returns {string} the whole page, rendered on the server: it needs no script. */
export function renderHtml(model) {
  const allTiers = [...new Set(model.categories.flatMap((c) => c.tierOrder))]
  const tierColorIndex = Object.fromEntries(
    allTiers.map((tier, i) => [tier, i % CATEGORICAL_SLOTS.length]),
  )
  const body = model.categories
    .map((category, ci) => {
      const legend = category.tierOrder
        .map((tier) => {
          const slot = tierColorIndex[tier] ?? 0
          return `<li class="legend-item"><svg class="key" width="26" height="10" aria-hidden="true"><line class="series-line s${String(slot + 1)}" x1="1" x2="25" y1="5" y2="5" stroke-dasharray="${DASHES[slot % DASHES.length]}"/></svg>${escapeHtml(tier)}</li>`
        })
        .join("")
      const cards = category.groups
        .map((group, gi) => {
          const id = `c${String(ci)}g${String(gi)}`
          const chart = renderChartSvg(group, category.tierOrder, tierColorIndex, category.runs, id)
          return `<article class="chart-card"><h3>${escapeHtml(group.group)}</h3><p class="class-badge${group.complexityClass ? "" : " unknown"}">${escapeHtml(badgeText(group))}</p>${chart || '<p class="empty">No data</p>'}${chart ? renderDataTable(group, category.tierOrder, category.runs, model.repoUrl) : ""}</article>`
        })
        .join("")
      return `<section class="category" aria-labelledby="cat${String(ci)}"><h2 id="cat${String(ci)}">${escapeHtml(category.label)}</h2><p class="sub">${String(category.entryCount)} of ${String(category.totalEntryCount)} recorded run(s) shown (most recent ${String(model.maxEntries)} max). Each chart's data is available as a table beneath it.</p><ul class="legend" aria-label="Series">${legend}</ul><div class="grid">${cards}</div></section>`
    })
    .join("\n")

  const light = CATEGORICAL_SLOTS.map((s, i) => `    --series-${String(i + 1)}: ${s.light};`).join(
    "\n",
  )
  const dark = CATEGORICAL_SLOTS.map((s, i) => `      --series-${String(i + 1)}: ${s.dark};`).join(
    "\n",
  )
  const darkExplicit = CATEGORICAL_SLOTS.map(
    (s, i) => `    --series-${String(i + 1)}: ${s.dark};`,
  ).join("\n")
  const seriesRules = CATEGORICAL_SLOTS.map(
    (_s, i) =>
      `  .s${String(i + 1)} { stroke: var(--series-${String(i + 1)}); }\n  .series-dot.s${String(i + 1)} { fill: var(--series-${String(i + 1)}); stroke: var(--surface-1); }`,
  ).join("\n")

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Benchmark history</title>
<style>
  :root {
    color-scheme: light;
    --surface-1: #fcfcfb;
    --page: #f9f9f7;
    --text-primary: #0b0b0b;
    --text-secondary: #52514e;
    --gridline: #e1e0d9;
    --baseline: #8a897f;
    --border: rgba(11, 11, 11, 0.10);
    --link: #1a55a8;
${light}
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      color-scheme: dark;
      --surface-1: #1a1a19;
      --page: #0d0d0d;
      --text-primary: #ffffff;
      --text-secondary: #c3c2b7;
      --gridline: #2c2c2a;
      --baseline: #7b7a72;
      --border: rgba(255, 255, 255, 0.10);
      --link: #8ab4f8;
${dark}
    }
  }
  :root[data-theme="dark"] {
    color-scheme: dark;
    --surface-1: #1a1a19;
    --page: #0d0d0d;
    --text-primary: #ffffff;
    --text-secondary: #c3c2b7;
    --gridline: #2c2c2a;
    --baseline: #7b7a72;
    --border: rgba(255, 255, 255, 0.10);
    --link: #8ab4f8;
${darkExplicit}
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--page); color: var(--text-primary); font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 1200px; margin: 0 auto; padding: 24px 16px 64px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  h2 { font-size: 15px; margin: 0 0 2px; }
  a { color: var(--link); }
  p.lede, p.sub { color: var(--text-secondary); max-width: 72ch; }
  p.sub { margin: 0 0 4px; font-size: 12px; }
  section.methodology { background: var(--surface-1); border: 1px solid var(--border); border-radius: 8px; padding: 16px 20px; margin: 16px 0 28px; }
  section.methodology p { margin: 6px 0; color: var(--text-secondary); }
  section.methodology strong { color: var(--text-primary); }
  .category { margin-bottom: 40px; }
  .legend { display: flex; flex-wrap: wrap; gap: 14px; margin: 8px 0 16px; padding: 0; list-style: none; }
  .legend-item { display: flex; align-items: center; gap: 6px; color: var(--text-secondary); font-size: 12px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 16px; }
  .chart-card { background: var(--surface-1); border: 1px solid var(--border); border-radius: 8px; padding: 12px 14px 8px; }
  .chart-card h3 { font-size: 13px; margin: 0 0 2px; font-family: ui-monospace, monospace; overflow-wrap: anywhere; }
  .class-badge { display: inline-block; font-size: 11px; color: var(--text-secondary); background: var(--page); border: 1px solid var(--border); border-radius: 4px; padding: 1px 6px; margin: 0 0 6px; }
  svg.chart { width: 100%; height: auto; background: var(--surface-1); }
  .gridline { stroke: var(--gridline); stroke-width: 1; }
  .axis { stroke: var(--baseline); stroke-width: 1; }
  .axis-label { fill: var(--text-secondary); font-size: 9px; }
  .series-label { fill: var(--text-primary); font-size: 9px; }
  .series-line { fill: none; stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
  .series-dot { stroke-width: 2; }
${seriesRules}
  .empty { color: var(--text-secondary); font-size: 12px; padding: 20px 0; }
  details.data { margin: 6px 0 4px; font-size: 12px; }
  details.data summary { cursor: pointer; color: var(--link); padding: 4px 0; }
  details.data summary:focus-visible { outline: 2px solid var(--link); outline-offset: 2px; }
  details.data table { border-collapse: collapse; width: 100%; margin-top: 6px; display: block; overflow-x: auto; }
  details.data caption { text-align: left; color: var(--text-secondary); padding: 2px 0 6px; }
  details.data th, details.data td { text-align: left; padding: 2px 8px 2px 0; font-variant-numeric: tabular-nums; white-space: nowrap; border-bottom: 1px solid var(--border); }
  footer { color: var(--text-secondary); font-size: 11px; margin-top: 32px; }
  @media (forced-colors: active) {
    .series-line { stroke: CanvasText; }
    .series-dot { fill: CanvasText; stroke: Canvas; }
    .gridline { stroke: GrayText; }
    .axis { stroke: CanvasText; }
    .axis-label, .series-label { fill: CanvasText; }
    .chart-card, section.methodology, .class-badge { border-color: CanvasText; }
  }
</style>
</head>
<body>
<main>
  <h1>Benchmark history</h1>
  <p class="lede">Committed benchmark history, rendered fresh on every deploy. Each chart names the version and date of its first and last run, and every figure is also available as a table that links the commit and pull request it was measured at.</p>
  ${model.readmeUrl ? `<p class="lede">New here? <a href="${escapeHtml(model.readmeUrl)}">Read this package's benchmarks guide</a> for what is measured, how to read the results, and how they are documented.</p>` : ""}

  <section class="methodology" aria-label="How to read these charts">
    <p><strong>What's measured:</strong> the median wall-clock time of each named benchmark group, at each of its declared input-size tiers, recorded after each merge that touches benchmarked code.</p>
    <p><strong>Absolute timing is not comparable machine-to-machine:</strong> these numbers come from whatever CI runner measured a given commit, and runner hardware varies. A single point moving a little is expected noise, not necessarily a regression.</p>
    <p><strong>What IS trustworthy regardless of machine: the inferred complexity class</strong> shown under each chart's title, and the package's overhead relative to its own baseline. They describe the shape of the cost curve, not its level. A class change (for example linear to quadratic) is the signal worth investigating; a wiggling line within the same class usually is not.</p>
  </section>

${body}

  <footer>Generated ${escapeHtml(model.generatedAt)}.</footer>
</main>
</body>
</html>
`
}

/**
 * Runs the command: parses `argv`, builds the model from the history files and writes the page.
 * @param {string[]} argv - the command-line arguments after the script name.
 * @param {{ log: (text: string) => void, error: (text: string) => void }} io - where messages go.
 * @returns {Promise<number>} the process exit code.
 */
export async function run(argv, io) {
  const args = parseArgs(argv)
  if (args.help || !args.out || args.histories.length === 0) {
    io.error(
      "Usage: node render-page.mjs --out <docs/benchmarks/index.html> --history 'label|path/to/history.json' [--history ...] [--max-entries 200] [--readme <url of the package's benchmarks/README.md>] [--repo <https://github.com/owner/repo, to link commits and pull requests>]",
    )
    return args.help ? 0 : 1
  }
  if (!Number.isFinite(args.maxEntries) || args.maxEntries <= 0)
    args.maxEntries = DEFAULT_MAX_ENTRIES

  const model = await buildPageModel(args)
  const html = renderHtml(model)

  await fs.mkdir(path.dirname(args.out), { recursive: true })
  await fs.writeFile(args.out, html)
  io.log(`[render-page] wrote ${args.out} (${model.categories.length} categories)`)
  return 0
}

// The process entry point: three lines that hand argv to `run` (tested in-process) and turn its result
// into an exit code. Its test spawns the script, which coverage cannot attribute to this file.
// Stryker disable BlockStatement, ConditionalExpression, CallExpression, StringLiteral, ArrowFunction, MethodExpression, ObjectLiteral: process entry point, exercised only by spawning the script
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  run(process.argv.slice(2), { log: console.log, error: console.error })
    .then((code) => {
      process.exitCode = code
    })
    .catch((err) => {
      console.error(err)
      process.exitCode = 1
    })
}
// Stryker restore BlockStatement, ConditionalExpression, CallExpression, StringLiteral, ArrowFunction, MethodExpression, ObjectLiteral
