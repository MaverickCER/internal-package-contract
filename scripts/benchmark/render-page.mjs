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
// minimal vanilla-JS crosshair+tooltip hover, dark mode selected via both
// `prefers-color-scheme` and a `data-theme` toggle scope, using the skill's
// own validated default palette (references/palette.md) unchanged.
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

function parseArgs(argv) {
  const args = { histories: [], maxEntries: DEFAULT_MAX_ENTRIES }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--out") args.out = argv[++i]
    else if (arg === "--history") args.histories.push(argv[++i])
    else if (arg === "--max-entries") args.maxEntries = Number(argv[++i])
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

  let latestClassification = { complexityClass: null, reason: "insufficient-data" }
  for (let i = entries.length - 1; i >= 0; i--) {
    const tiers = entries[i].measurements?.[group]
    if (tiers) {
      latestClassification = classifyGroup(tiers)
      break
    }
  }

  return { group, series, ...latestClassification }
}

export async function buildPageModel({ histories, maxEntries }) {
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
      groups,
    })
  }
  return { generatedAt: new Date().toISOString(), maxEntries, categories }
}

function renderHtml(model) {
  const allTiers = [...new Set(model.categories.flatMap((c) => c.tierOrder))]
  const tierColorIndex = Object.fromEntries(
    allTiers.map((tier, i) => [tier, i % CATEGORICAL_SLOTS.length]),
  )
  const dataJson = JSON.stringify({ ...model, tierColorIndex }).replace(/</g, "\\u003c")

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
    --text-muted: #898781;
    --gridline: #e1e0d9;
    --baseline: #c3c2b7;
    --border: rgba(11, 11, 11, 0.10);
${CATEGORICAL_SLOTS.map((s, i) => `    --series-${i + 1}: ${s.light};`).join("\n")}
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      color-scheme: dark;
      --surface-1: #1a1a19;
      --page: #0d0d0d;
      --text-primary: #ffffff;
      --text-secondary: #c3c2b7;
      --text-muted: #898781;
      --gridline: #2c2c2a;
      --baseline: #383835;
      --border: rgba(255, 255, 255, 0.10);
${CATEGORICAL_SLOTS.map((s, i) => `      --series-${i + 1}: ${s.dark};`).join("\n")}
    }
  }
  :root[data-theme="dark"] {
    color-scheme: dark;
    --surface-1: #1a1a19;
    --page: #0d0d0d;
    --text-primary: #ffffff;
    --text-secondary: #c3c2b7;
    --text-muted: #898781;
    --gridline: #2c2c2a;
    --baseline: #383835;
    --border: rgba(255, 255, 255, 0.10);
${CATEGORICAL_SLOTS.map((s, i) => `    --series-${i + 1}: ${s.dark};`).join("\n")}
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--page);
    color: var(--text-primary);
    font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  main { max-width: 1200px; margin: 0 auto; padding: 24px 16px 64px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  h2 { font-size: 15px; margin: 0 0 2px; }
  p.lede { color: var(--text-secondary); max-width: 72ch; }
  section.methodology {
    background: var(--surface-1);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 16px 20px;
    margin: 16px 0 28px;
  }
  section.methodology p { margin: 6px 0; color: var(--text-secondary); }
  section.methodology strong { color: var(--text-primary); }
  .category { margin-bottom: 40px; }
  .legend { display: flex; flex-wrap: wrap; gap: 14px; margin: 8px 0 16px; }
  .legend-item { display: flex; align-items: center; gap: 6px; color: var(--text-secondary); font-size: 12px; }
  .swatch { width: 10px; height: 10px; border-radius: 2px; display: inline-block; }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: 16px;
  }
  .chart-card {
    background: var(--surface-1);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 12px 14px 8px;
    position: relative;
  }
  .chart-card h3 { font-size: 13px; margin: 0 0 2px; font-family: ui-monospace, monospace; }
  .class-badge {
    display: inline-block;
    font-size: 11px;
    color: var(--text-secondary);
    background: var(--page);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 1px 6px;
    margin-bottom: 6px;
  }
  .class-badge.unknown { color: var(--text-muted); }
  svg.chart { width: 100%; height: 140px; overflow: visible; }
  .gridline { stroke: var(--gridline); stroke-width: 1; }
  .axis { stroke: var(--baseline); stroke-width: 1; }
  .axis-label { fill: var(--text-muted); font-size: 9px; }
  .series-line { fill: none; stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
  .series-dot { stroke: var(--surface-1); stroke-width: 2; }
  .crosshair { stroke: var(--text-muted); stroke-width: 1; stroke-dasharray: 2 2; pointer-events: none; }
  .tooltip {
    position: absolute;
    pointer-events: none;
    background: var(--surface-1);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 6px 8px;
    font-size: 11px;
    box-shadow: 0 2px 8px var(--border);
    white-space: nowrap;
    z-index: 10;
    display: none;
  }
  .tooltip .row { display: flex; align-items: center; gap: 6px; }
  .tooltip .value { color: var(--text-primary); font-variant-numeric: tabular-nums; }
  .empty { color: var(--text-muted); font-size: 12px; padding: 20px 0; }
  footer { color: var(--text-muted); font-size: 11px; margin-top: 32px; }
</style>
</head>
<body>
<main>
  <h1>Benchmark history</h1>
  <p class="lede">Committed benchmark history, rendered fresh on every deploy.</p>

  <section class="methodology">
    <p><strong>What's measured:</strong> the median wall-clock time (\`medianMs\`) of each named benchmark group, at each of its declared input-size tiers, tracked across successive CI runs.</p>
    <p><strong>Absolute timing is not comparable machine-to-machine:</strong> these numbers come from whatever CI runner happened to execute a given commit, and runner hardware varies run to run. A single point moving up or down a little is expected noise, not necessarily a regression.</p>
    <p><strong>What IS trustworthy regardless of which machine ran it: a change in the inferred complexity class</strong> (shown under each chart's title). That's a statement about the shape of the cost curve -- how time grows as input size grows -- not its absolute level, so it holds even when two runs never touched the same hardware. A class change (e.g. \`linear\` → \`quadratic\`) is the signal worth investigating; a wiggling line within the same class usually isn't.</p>
  </section>

  <div id="app"></div>

  <footer id="footer"></footer>
</main>
<div class="tooltip" id="tooltip"></div>
<script id="benchmark-data" type="application/json">${dataJson}</script>
<script>
(function () {
  "use strict";
  var model = JSON.parse(document.getElementById("benchmark-data").textContent);
  var SVGNS = "http://www.w3.org/2000/svg";
  var app = document.getElementById("app");
  var tooltip = document.getElementById("tooltip");

  function seriesColor(tier) {
    var idx = model.tierColorIndex[tier] || 0;
    return "var(--series-" + (idx + 1) + ")";
  }

  function el(tag, attrs, children) {
    var e = document.createElement(tag);
    for (var k in attrs || {}) e.setAttribute(k, attrs[k]);
    (children || []).forEach(function (c) { e.appendChild(c); });
    return e;
  }

  function svgEl(tag, attrs) {
    var e = document.createElementNS(SVGNS, tag);
    for (var k in attrs || {}) e.setAttribute(k, attrs[k]);
    return e;
  }

  function renderLegend(tierOrder) {
    var legend = el("div", { class: "legend" });
    tierOrder.forEach(function (tier) {
      var item = el("div", { class: "legend-item" });
      var swatch = el("span", { class: "swatch" });
      swatch.style.background = seriesColor(tier);
      item.appendChild(swatch);
      item.appendChild(document.createTextNode(tier));
      legend.appendChild(item);
    });
    return legend;
  }

  function classBadgeText(g) {
    if (g.complexityClass) return "Inferred complexity: " + g.complexityClass;
    if (g.reason === "no-size-variation") return "Inferred complexity: unavailable (no size variation across tiers)";
    return "Inferred complexity: unavailable (fewer than 2 tiers with recorded inputs)";
  }

  function renderChart(group, tierOrder) {
    var card = el("div", { class: "chart-card" });
    card.appendChild(el("h3", {}, [document.createTextNode(group.group)]));
    var badge = el("span", { class: "class-badge" + (group.complexityClass ? "" : " unknown") });
    badge.textContent = classBadgeText(group);
    card.appendChild(badge);

    var allPoints = [];
    group.series.forEach(function (s) { s.points.forEach(function (p) { if (p) allPoints.push(p); }); });
    if (allPoints.length === 0) {
      card.appendChild(el("div", { class: "empty" }, [document.createTextNode("No data")]));
      return card;
    }

    var width = 300, height = 140, padLeft = 34, padBottom = 16, padTop = 6, padRight = 6;
    var plotW = width - padLeft - padRight, plotH = height - padTop - padBottom;
    var maxIndex = Math.max.apply(null, allPoints.map(function (p) { return p.index; }));
    var maxY = Math.max.apply(null, allPoints.map(function (p) { return p.medianMs; })) * 1.08;
    if (maxY <= 0) maxY = 1;

    function x(i) { return padLeft + (maxIndex === 0 ? plotW / 2 : (i / maxIndex) * plotW); }
    function y(v) { return padTop + plotH - (v / maxY) * plotH; }

    var svg = svgEl("svg", { class: "chart", viewBox: "0 0 " + width + " " + height, preserveAspectRatio: "none" });

    // Gridlines (3 horizontal, hairline, recessive) + baseline axis.
    for (var gi = 0; gi <= 2; gi++) {
      var gy = padTop + (plotH / 2) * gi;
      svg.appendChild(svgEl("line", { class: "gridline", x1: padLeft, x2: width - padRight, y1: gy, y2: gy }));
      var label = svgEl("text", { class: "axis-label", x: 2, y: gy + 3 });
      label.textContent = (maxY * (1 - gi / 2)).toFixed(maxY < 1 ? 3 : 1);
      svg.appendChild(label);
    }
    svg.appendChild(svgEl("line", { class: "axis", x1: padLeft, x2: width - padRight, y1: height - padBottom, y2: height - padBottom }));

    tierOrder.forEach(function (tier) {
      var s = group.series.filter(function (s) { return s.tier === tier; })[0];
      if (!s) return;
      var segments = [];
      var current = [];
      s.points.forEach(function (p) {
        if (p) current.push(p);
        else if (current.length) { segments.push(current); current = []; }
      });
      if (current.length) segments.push(current);
      if (segments.length === 0) return;

      var color = seriesColor(tier);
      segments.forEach(function (seg) {
        var d = seg.map(function (p, idx) { return (idx === 0 ? "M" : "L") + x(p.index).toFixed(1) + " " + y(p.medianMs).toFixed(1); }).join(" ");
        svg.appendChild(svgEl("path", { class: "series-line", d: d, style: "stroke:" + color }));
      });
      var last = segments[segments.length - 1];
      var lastPoint = last[last.length - 1];
      var dot = svgEl("circle", { class: "series-dot", cx: x(lastPoint.index), cy: y(lastPoint.medianMs), r: 4 });
      dot.style.fill = color;
      svg.appendChild(dot);
    });

    var crosshair = svgEl("line", { class: "crosshair", y1: padTop, y2: height - padBottom, x1: -100, x2: -100 });
    svg.appendChild(crosshair);

    svg.addEventListener("mousemove", function (evt) {
      var rect = svg.getBoundingClientRect();
      var relX = ((evt.clientX - rect.left) / rect.width) * width;
      var i = maxIndex === 0 ? 0 : Math.round(((relX - padLeft) / plotW) * maxIndex);
      i = Math.max(0, Math.min(maxIndex, i));
      crosshair.setAttribute("x1", x(i));
      crosshair.setAttribute("x2", x(i));

      var rows = [];
      tierOrder.forEach(function (tier) {
        var s = group.series.filter(function (s) { return s.tier === tier; })[0];
        var p = s ? s.points[i] : null;
        if (p) rows.push('<div class="row"><span class="swatch" style="background:' + seriesColor(tier) + '"></span>' + tier + ': <span class="value">' + p.medianMs.toFixed(3) + " ms</span></div>");
      });
      if (rows.length === 0) { tooltip.style.display = "none"; return; }
      tooltip.innerHTML = "<div><strong>run #" + (i + 1) + "</strong></div>" + rows.join("");
      tooltip.style.display = "block";
      tooltip.style.left = (evt.clientX + 14) + "px";
      tooltip.style.top = (evt.clientY + 14) + "px";
    });
    svg.addEventListener("mouseleave", function () {
      tooltip.style.display = "none";
      crosshair.setAttribute("x1", -100);
      crosshair.setAttribute("x2", -100);
    });

    card.appendChild(svg);
    return card;
  }

  model.categories.forEach(function (category) {
    var section = el("div", { class: "category" });
    section.appendChild(el("h2", {}, [document.createTextNode(category.label)]));
    var sub = el("p", { class: "lede" });
    sub.style.margin = "0 0 4px";
    sub.style.fontSize = "12px";
    sub.textContent = category.entryCount + " of " + category.totalEntryCount + " recorded run(s) shown (most recent " + model.maxEntries + " max).";
    section.appendChild(sub);
    section.appendChild(renderLegend(category.tierOrder));
    var grid = el("div", { class: "grid" });
    category.groups.forEach(function (group) {
      grid.appendChild(renderChart(group, category.tierOrder));
    });
    section.appendChild(grid);
    app.appendChild(section);
  });

  document.getElementById("footer").textContent = "Generated " + model.generatedAt + ".";
})();
</script>
</body>
</html>
`
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help || !args.out || args.histories.length === 0) {
    console.error(
      "Usage: node render-page.mjs --out <docs/benchmarks/index.html> --history 'label|path/to/history.json' [--history ...] [--max-entries 200]",
    )
    process.exitCode = args.help ? 0 : 1
    return
  }
  if (!Number.isFinite(args.maxEntries) || args.maxEntries <= 0)
    args.maxEntries = DEFAULT_MAX_ENTRIES

  const model = await buildPageModel(args)
  const html = renderHtml(model)

  await fs.mkdir(path.dirname(args.out), { recursive: true })
  await fs.writeFile(args.out, html, "utf8")
  console.log(`[render-page] wrote ${args.out} (${model.categories.length} categories)`)
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  main().catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
}
