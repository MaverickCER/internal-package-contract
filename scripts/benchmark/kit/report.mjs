// Renders results.json as the human report (BENCHMARKS.md). It leans toward COSTS on purpose: the
// first thing a platform engineer or CTO sees is what adopting the package adds to a request, a
// monthly bill and a cold start -- the benefits live in the rest of the repository. Every number is a
// single run's measurement on one machine; the report says so, and links the reading guide.

import { COMPLEXITY_NOTATION, expectationOf } from "./define.mjs"
import { formatUsd } from "./cost-model.mjs"

/**
 * @param {number} ms - milliseconds.
 * @returns {string} a compact duration (µs below 1 ms, seconds above 1000 ms).
 */
export function formatMs(ms) {
  if (!Number.isFinite(ms)) return "n/a"
  if (ms === 0) return "0"
  if (ms < 1) return `${(ms * 1000).toPrecision(3)} µs`
  if (ms < 1000) return `${ms.toPrecision(3)} ms`
  return `${(ms / 1000).toPrecision(3)} s`
}

/**
 * @param {number} bytes - a byte count (may be negative: a heap delta).
 * @returns {string} a compact size.
 */
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "n/a"
  const abs = Math.abs(bytes)
  const sign = bytes < 0 ? "-" : ""
  if (abs < 1024) return `${sign}${String(Math.round(abs))} B`
  if (abs < 1024 * 1024) return `${sign}${(abs / 1024).toFixed(1)} KiB`
  return `${sign}${(abs / (1024 * 1024)).toFixed(1)} MiB`
}

const percent = (value) => {
  if (value === null || !Number.isFinite(value)) return "n/a"
  // Against an empty baseline the relative overhead is huge by construction; show a multiple instead.
  if (value >= 1000) return `${Math.round(value / 100 + 1).toLocaleString("en-US")}× baseline`
  return `${value.toFixed(value < 10 ? 1 : 0)}%`
}
/** A price range, smallest first (CPU time can exceed wall time, so "low" is not always lower). */
const range = (a, b) => {
  const [low, high] = a <= b ? [a, b] : [b, a]
  return formatUsd(low) === formatUsd(high)
    ? formatUsd(low)
    : `${formatUsd(low)} – ${formatUsd(high)}`
}
const row = (cells) => `| ${cells.join(" | ")} |`
const table = (header, rows) => [row(header), row(header.map(() => "---")), ...rows.map(row)]
const AGREEMENT_LABEL = {
  matches: "✅ matches",
  close: "🟡 close (neighbouring class)",
  differs: "⚠️ differs",
  unknown: "❔ not enough data",
}

function growthSentence(complexity) {
  if (!complexity?.class) return "its growth rate could not be determined from this run"
  return `it grows ${complexity.notation} with workload size (measured exponent ${complexity.exponent.toFixed(2)})`
}

function glance(results) {
  const { analysis, metadata } = results
  const { typical, largest, typicalN } = analysis.cost
  const unit = metadata.workload.unit
  const lines = ["## What adopting this package costs", ""]
  if (!typical) {
    lines.push(
      "_The end-to-end benchmark produced no complete result at the typical workload size, so no cost summary is available. See the failed/skipped section._",
      "",
    )
    return lines
  }
  const overheadComplexity = analysis.complexity["end-to-end:with-package"]
  lines.push(
    `For a typical workload of **${String(typicalN)} ${unit}s** per operation, routing the work through \`${metadata.package.name}\` adds **${formatMs(typical.overheadMs)}** per operation compared with a bare-minimum baseline (${percent(typical.overheadPercent)}), about **${range(typical.cost.lowUsdPerMillion, typical.cost.highUsdPerMillion)} per million operations** of compute. Overall, ${growthSentence(overheadComplexity)}.`,
    "",
    "> Dollar figures are **estimates** from published list prices (see _Cost model_ below) and are for comparing orders of magnitude, not for budgeting to the cent.",
    "",
  )
  const bundle = Object.values(metadata.bundleSizes ?? {}).reduce(
    (sum, size) => sum + (size.gzipBytes ?? 0),
    0,
  )
  lines.push(
    ...table(
      ["Cost", `Typical (${String(typicalN)} ${unit}s)`, `Largest (${String(largest.n)} ${unit}s)`],
      [
        ["Added latency per operation", formatMs(typical.overheadMs), formatMs(largest.overheadMs)],
        [
          "Added latency, relative to baseline",
          percent(typical.overheadPercent),
          percent(largest.overheadPercent),
        ],
        [
          "Added CPU time per operation",
          formatMs(typical.overheadCpuMs),
          formatMs(largest.overheadCpuMs),
        ],
        [
          "Added memory per operation (heap delta)",
          formatBytes(typical.overheadHeapBytes),
          formatBytes(largest.overheadHeapBytes),
        ],
        [
          "Estimated compute cost per 1M operations",
          range(typical.cost.lowUsdPerMillion, typical.cost.highUsdPerMillion),
          range(largest.cost.lowUsdPerMillion, largest.cost.highUsdPerMillion),
        ],
        [
          "Single-core throughput ceiling of the overhead alone",
          `${Math.round(typical.cost.opsPerSecondPerCore).toLocaleString("en-US")} ops/s`,
          `${Math.round(largest.cost.opsPerSecondPerCore).toLocaleString("en-US")} ops/s`,
        ],
        ...(bundle > 0
          ? [
              [
                "Shipped code parsed at every cold start (gzip)",
                formatBytes(bundle),
                formatBytes(bundle),
              ],
            ]
          : []),
      ],
    ),
    "",
  )
  return lines
}

function endToEndSection(results, suite) {
  const { analysis, metadata } = results
  const unit = metadata.workload.unit
  const lines = ["## 1. End-to-end: the package's total impact", ""]
  lines.push(suite.endToEnd.purpose, "")
  lines.push(`- **Baseline (no package):** ${suite.endToEnd.baseline.description}`)
  lines.push(`- **With the package:** ${suite.endToEnd.withPackage.description}`, "")
  lines.push(
    "Both sides use empty or minimal functions on purpose, so the difference is the package's own cost -- not the cost of the work an application would plug into it. Real applications add their own work on top; this is the floor the package imposes.",
    "",
  )
  if (suite.endToEnd.variables?.length) {
    lines.push(
      "**Variables that could change this result**",
      "",
      ...table(
        ["Variable", "How it is handled", "What it is"],
        suite.endToEnd.variables.map((v) => [
          v.name,
          v.how === "fixed" ? `fixed at ${JSON.stringify(v.value)}` : v.how,
          v.description,
        ]),
      ),
      "",
    )
  }
  lines.push(
    "The baseline is an empty or minimal function, so it costs almost nothing and the _relative_ overhead can look enormous (shown as a multiple of the baseline). Read the absolute columns -- time, CPU and dollars added -- they are what a bill and a latency budget are made of.",
    "",
    ...table(
      [
        unit + "s",
        "Baseline",
        "With package",
        "Added",
        "Added vs baseline",
        "Added CPU",
        "Est. $ / 1M ops",
      ],
      analysis.endToEnd.map((r) => [
        String(r.n),
        formatMs(r.baselineMs),
        formatMs(r.withPackageMs),
        formatMs(r.overheadMs),
        percent(r.overheadPercent),
        formatMs(r.overheadCpuMs),
        range(r.cost.lowUsdPerMillion, r.cost.highUsdPerMillion),
      ]),
    ),
    "",
  )
  const complexity = analysis.complexity["end-to-end:with-package"]
  if (complexity?.class) {
    lines.push(
      `**How the total grows:** ${complexity.notation} (${complexity.class}), exponent ${complexity.exponent.toFixed(2)} over ${String(complexity.points)} sizes.`,
      "",
    )
  }
  return lines
}

function groupTable(group, unit) {
  const header = [unit + "s", "Median", "p95", "CPU (median)", "Heap Δ", "Ops/s"]
  const rows = Object.values(group.tiers).map((entry) =>
    entry.status === "completed"
      ? [
          String(entry.inputs[unit]),
          formatMs(entry.durationMs.medianMs),
          formatMs(entry.durationMs.p95Ms),
          formatMs(entry.cpuMs.medianMs),
          formatBytes(entry.heapDeltaBytes),
          entry.opsPerSecond === null
            ? "n/a"
            : Math.round(entry.opsPerSecond).toLocaleString("en-US"),
        ]
      : [String(entry.inputs[unit]), `❌ ${entry.error?.message ?? "failed"}`, "", "", "", ""],
  )
  return table(header, rows)
}

function functionsSection(results, suite) {
  const { analysis, metadata } = results
  const unit = metadata.workload.unit
  const lines = ["## 2. Function by function", ""]
  lines.push(
    "Every function the package exposes is measured on its own across the full size ladder, then its measured growth rate is compared with the big-O we documented for it. A function whose measured class **differs** from its documented one is the most useful thing in this report: either the documentation or the code is wrong.",
    "",
  )

  const summary = []
  for (const fn of suite.functions) {
    for (const variant of fn.variants?.length ? fn.variants : [undefined]) {
      const group = variant ? `fn:${fn.id}@${variant.name}` : `fn:${fn.id}`
      const found = results.results[group]
      const measured = analysis.complexity[group]
      // A function measured on a shorter ladder shows its nearest measured size, labelled.
      const at = (target) => {
        const done = Object.values(found?.tiers ?? {}).filter(
          (entry) => entry.status === "completed",
        )
        const nearest = done.sort(
          (a, b) => Math.abs(a.inputs[unit] - target) - Math.abs(b.inputs[unit] - target),
        )[0]
        if (!nearest) return "n/a"
        const text = formatMs(nearest.durationMs.medianMs)
        return nearest.inputs[unit] === target
          ? text
          : `${text} (at ${String(nearest.inputs[unit])})`
      }
      summary.push([
        `\`${fn.name}\`${variant ? ` (${variant.name})` : ""}`,
        COMPLEXITY_NOTATION[expectationOf(fn, variant).expectedComplexity],
        measured?.notation ?? "n/a",
        AGREEMENT_LABEL[measured?.agreement ?? "unknown"],
        at(analysis.cost.typicalN),
        at(metadata.tiers[metadata.tiers.length - 1]),
      ])
    }
  }
  lines.push(
    ...table(
      [
        "Function",
        "Documented",
        "Measured",
        "Agreement",
        `At ${String(analysis.cost.typicalN)}`,
        `At ${String(metadata.tiers[metadata.tiers.length - 1])}`,
      ],
      summary,
    ),
    "",
  )
  const differing = Object.entries(analysis.complexity).filter(
    ([group, value]) => group.startsWith("fn:") && value.agreement === "differs",
  )
  if (differing.length > 0) {
    lines.push(
      "> **Needs attention.** These functions grow at a different rate than documented. Either the code regressed or the documentation is wrong -- decide which, then fix it:",
      ">",
      ...differing.map(
        ([group, value]) =>
          `> - \`${group.slice(3)}\`: documented ${value.expectedNotation}, measured ${value.notation} (exponent ${value.exponent.toFixed(2)})`,
      ),
      "",
    )
  }

  for (const fn of suite.functions) {
    lines.push(`### \`${fn.name}\``, "")
    lines.push(`**Why we benchmark it.** ${fn.why}`, "")
    lines.push(`**What poor performance would mean.** ${fn.poorPerformanceMeans}`, "")
    lines.push(
      `**Expected growth: ${COMPLEXITY_NOTATION[fn.expectedComplexity]}.** ${fn.complexityReason}`,
      "",
    )
    if (fn.tiers) {
      lines.push(`**Measured on a shorter ladder (${fn.tiers.join(", ")}).** ${fn.tiersReason}`, "")
    }
    lines.push(
      "**Variables that could change its cost**",
      "",
      ...table(
        ["Variable", "How it is handled", "What it is"],
        fn.variables.map((v) => [
          v.name,
          v.how === "fixed" ? `fixed at ${JSON.stringify(v.value)}` : v.how,
          v.description,
        ]),
      ),
      "",
    )
    if (fn.notCovered?.length) {
      lines.push(
        "**Deliberately not covered**",
        "",
        ...fn.notCovered.map((item) => `- **${item.name}** -- ${item.reason}`),
        "",
      )
    }
    if (fn.inEndToEnd) lines.push(`**In the end-to-end run:** ${fn.inEndToEnd.description}`, "")
    for (const variant of fn.variants?.length ? fn.variants : [undefined]) {
      const group = variant ? `fn:${fn.id}@${variant.name}` : `fn:${fn.id}`
      const measured = analysis.complexity[group]
      if (variant) {
        lines.push(`#### Variant \`${variant.name}\``, "", variant.description, "")
        if (variant.expectedComplexity !== undefined) {
          lines.push(
            `**Expected for this variant: ${COMPLEXITY_NOTATION[variant.expectedComplexity]}.** ${variant.complexityReason}`,
            "",
          )
        }
      }
      if (measured?.class) {
        lines.push(
          `**Measured: ${measured.notation}** (exponent ${measured.exponent.toFixed(2)}, ${String(measured.points)} sizes) -- ${AGREEMENT_LABEL[measured.agreement]}.`,
          "",
        )
      }
      if (results.results[group]) lines.push(...groupTable(results.results[group], unit), "")
    }
  }
  return lines
}

function contributionSection(results) {
  const { analysis, metadata } = results
  const unit = metadata.workload.unit
  const lines = ["## 3. What makes up the end-to-end overhead", ""]
  if (analysis.contribution.length === 0) {
    lines.push(
      "_No function declared how it is used in the end-to-end run (`inEndToEnd`), so there is nothing to attribute._",
      "",
    )
    return lines
  }
  lines.push(
    "Each function's measured cost is multiplied by how many times one end-to-end operation calls it, then compared with the total overhead from section 1. This shows where the cost actually lives, so effort goes to the function that matters. Shares are estimates: they can sum to slightly more or less than 100% because the two measurements were taken separately (the remainder is shown as _unattributed_).",
    "",
  )
  for (const n of [analysis.cost.typicalN, metadata.tiers[metadata.tiers.length - 1]]) {
    const total = analysis.endToEnd.find((r) => r.n === n)
    if (!total) continue
    const rows = analysis.contribution
      .map((c) => ({ c, r: c.rows.find((x) => x.n === n) }))
      .filter((x) => x.r)
      .sort((a, b) => b.r.estimatedMs - a.r.estimatedMs)
    const attributed = rows.reduce((sum, x) => sum + x.r.estimatedMs, 0)
    lines.push(`**At ${String(n)} ${unit}s** (total added: ${formatMs(total.overheadMs)})`, "")
    lines.push(
      ...table(
        [
          "Function",
          "Calls / operation",
          "Estimated time",
          "Share of added time",
          "Share of operation",
        ],
        [
          ...rows.map((x) => [
            `\`${x.c.id}\``,
            String(x.r.calls),
            formatMs(x.r.estimatedMs),
            percent(x.r.shareOfOverhead === null ? null : x.r.shareOfOverhead * 100),
            percent(x.r.shareOfTotal === null ? null : x.r.shareOfTotal * 100),
          ]),
          [
            "_unattributed_",
            "",
            formatMs(Math.max(0, total.overheadMs - attributed)),
            percent(
              total.overheadMs > 0
                ? (Math.max(0, total.overheadMs - attributed) / total.overheadMs) * 100
                : null,
            ),
            "",
          ],
        ],
      ),
      "",
    )
  }
  return lines
}

function failures(results) {
  const failed = []
  for (const [group, value] of Object.entries(results.results)) {
    for (const [tier, entry] of Object.entries(value.tiers)) {
      if (entry.status !== "completed")
        failed.push(
          `- **${group}** at ${tier}: ${entry.error?.name ?? entry.status}: ${entry.error?.message ?? ""}`,
        )
    }
  }
  return failed.length === 0 ? [] : ["## Failed measurements", "", ...failed, ""]
}

function footer(results, docs) {
  const { metadata } = results
  const e = metadata.environment
  const rates = metadata.costRates
  return [
    "## Cost model",
    "",
    `Estimates use two bracketing price shapes: **low** = CPU-priced compute (${formatUsd(rates.vCpuHourUsd)} per vCPU-hour, billed on CPU time) and **high** = duration-and-memory-priced functions (${formatUsd(rates.gbSecondUsd)} per GB-second, billed on wall time, at least ${String(rates.minMemoryMb)} MB reserved). Both are rounded list prices and change over time; override them in \`benchmark.config.json\` → \`costRates\` to match your platform and negotiated pricing.`,
    "",
    "## Environment and method",
    "",
    `- Run: \`${metadata.timing.startedAtUtc}\` → \`${metadata.timing.finishedAtUtc}\` (${String(Math.round(metadata.timing.totalSuiteDurationMs / 1000))} s), ${metadata.generatedBy}`,
    `- Machine: ${e.cpuModel ?? "unknown CPU"}, ${String(e.logicalCores)} logical core(s)${e.physicalCores ? ` (${String(e.physicalCores)} physical)` : ""}, ${String(e.totalMemoryMb)} MB RAM, ${e.platform}/${e.processArch}, Node ${e.nodeVersion}, ${e.runner}`,
    `- Git: \`${metadata.git.gitCommit ?? "unknown"}\` on \`${metadata.git.gitBranch ?? "unknown"}\`${metadata.git.gitDirty ? " (uncommitted changes)" : ""}`,
    `- Sizes: ${metadata.tiers.join(", ")} ${metadata.workload.unit}s -- ${metadata.workload.description}`,
    "",
    `**Do not compare these numbers with another machine's, another day's, or another package's.** They exist to show how _this_ package's cost changes between runs on comparable hardware and how it scales with size. See [READING-BENCHMARKS.md](${docs}READING-BENCHMARKS.md).`,
    "",
  ]
}

/**
 * @param {object} results - a results object from runSuite.
 * @param {object} suite - the suite that produced it (for the documentation text).
 * @param {{ docsPath?: string }} [options] - where the reading guide lives relative to the report (default: next to it).
 * @returns {string} the Markdown report.
 */
export function renderReport(results, suite, options = {}) {
  const docs = options.docsPath ? `${options.docsPath}/` : ""
  const name = results.metadata.package.name
  return [
    `# ${name}: performance and cost report`,
    "",
    `What does adopting this package add to latency, CPU, memory and compute spend -- and how does that grow with workload? Three views, from the whole to the part: **(1)** the end-to-end total, **(2)** every function on its own, **(3)** which functions make up the total. New to benchmarks? Read [READING-BENCHMARKS.md](${docs}READING-BENCHMARKS.md) first.`,
    "",
    ...glance(results),
    ...endToEndSection(results, suite),
    ...functionsSection(results, suite),
    ...contributionSection(results),
    ...failures(results),
    ...footer(results, docs),
  ].join("\n")
}
