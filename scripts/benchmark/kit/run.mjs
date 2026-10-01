// Runs a defined suite and produces the results object: raw per-tier measurements for every group
// (compatible with append-history / render-summary / render-page, which read
// `results[group].tiers[tier].durationMs.medianMs` and `inputs`), plus an `analysis` section that turns
// those measurements into the three things a platform engineer asks:
//   1. endToEnd     -- what does adopting the package add to one operation, at every size?
//   2. functions    -- how does each function scale, and does it match its documented big-O?
//   3. contribution -- which functions make up the end-to-end overhead, and how much each?

import { classifyGroup } from "../classify-complexity.mjs"
import { estimateCost, DEFAULT_RATES } from "./cost-model.mjs"
import { collectBundleSizes, collectEnvironment, collectGit } from "./environment.mjs"
import { computeDurationStats, sample } from "./measure.mjs"
import { COMPLEXITY_NOTATION, expectationOf } from "./define.mjs"
import { QUICK_TIERS, tierName } from "./tiers.mjs"

export const RESULTS_SCHEMA_VERSION = 3

const CLASS_ORDER = Object.keys(COMPLEXITY_NOTATION)

function median(values) {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] ?? 0
}

/**
 * How closely a measured class agrees with the documented expectation. Neighbouring classes are
 * "close" because constant-vs-logarithmic and linear-vs-linearithmic cannot be reliably told apart
 * on a bounded ladder (see classify-complexity.mjs); two or more classes apart is a real difference.
 * @param {string | null} measured - the measured class.
 * @param {string} expected - the documented class.
 * @returns {"matches" | "close" | "differs" | "unknown"} the agreement.
 */
export function agreement(measured, expected) {
  if (measured === null) return "unknown"
  const distance = Math.abs(CLASS_ORDER.indexOf(measured) - CLASS_ORDER.indexOf(expected))
  if (distance === 0) return "matches"
  return distance === 1 ? "close" : "differs"
}

async function measureTier({ n, unit, setup, run, teardown, fresh, sampling, group }) {
  let ctx
  const build = async () => {
    ctx = setup ? await setup(n) : undefined
  }
  const options = { ...sampling }
  if (fresh) {
    options.prepare = build
    options.release = async () => teardown?.(ctx)
  } else {
    await build()
  }
  try {
    const raw = await sample(() => run(ctx), options)
    const durationMs = computeDurationStats(raw.wallMs, raw.configuration.warmupIterations)
    return {
      id: `${group}@${tierName(n)}`,
      status: "completed",
      inputs: { [unit]: n },
      durationMs,
      cpuMs: computeDurationStats(raw.cpuMs, raw.configuration.warmupIterations),
      heapDeltaBytes: median(raw.heapDeltaBytes),
      opsPerSecond: durationMs.medianMs > 0 ? 1000 / durationMs.medianMs : null,
      configuration: raw.configuration,
    }
  } finally {
    if (!fresh) await teardown?.(ctx)
  }
}

async function measureGroup({
  group,
  area,
  tiers,
  unit,
  benchmark,
  variant,
  sampling,
  onProgress,
}) {
  const entries = {}
  for (const n of tiers) {
    onProgress?.(`${group} n=${String(n)}`)
    try {
      entries[tierName(n)] = await measureTier({
        n,
        unit,
        group,
        setup: benchmark.setup ? (size) => benchmark.setup(size, variant?.options) : undefined,
        run: (ctx) => benchmark.run(ctx),
        teardown: benchmark.teardown,
        fresh: benchmark.fresh === true,
        sampling: { ...sampling, ...(benchmark.sampling ?? {}) },
      })
    } catch (error) {
      entries[tierName(n)] = {
        id: `${group}@${tierName(n)}`,
        status: "failed",
        inputs: { [unit]: n },
        error: { name: error?.name ?? "Error", message: String(error?.message ?? error) },
      }
    }
  }
  return { area, tiers: entries }
}

/** Compact `{ tier: { medianMs, inputs } }` view of one group, the shape classify-complexity reads. */
function measurementsOf(group) {
  return Object.fromEntries(
    Object.entries(group.tiers)
      .filter(([, entry]) => entry.status === "completed")
      .map(([tier, entry]) => [
        tier,
        { medianMs: entry.durationMs.medianMs, inputs: entry.inputs },
      ]),
  )
}

function completedAt(group, n) {
  const entry = group?.tiers?.[tierName(n)]
  return entry?.status === "completed" ? entry : undefined
}

/**
 * @param {object} suite - a suite returned by defineSuite.
 * @param {{ quick?: boolean, only?: readonly string[], sampling?: object, rates?: object, root?: string, bundleFiles?: readonly string[], onProgress?: (message: string) => void, now?: () => Date }} [options] - run controls.
 * @returns {Promise<object>} the complete results object (schema version 3).
 */
export async function runSuite(suite, options = {}) {
  const now = options.now ?? (() => new Date())
  const startedAt = now()
  const tiers = options.quick ? QUICK_TIERS : suite.tiers
  const unit = suite.workload.unit
  const sampling =
    options.sampling ?? (options.quick ? { targetDurationMs: 80, maxIterations: 20 } : {})
  const selected = (id) => !options.only || options.only.length === 0 || options.only.includes(id)
  const results = {}

  if (selected("end-to-end")) {
    const side = (kind) => ({
      benchmark: {
        setup: suite.endToEnd[kind].setup,
        run: suite.endToEnd[kind].run,
        teardown: suite.endToEnd[kind].teardown,
        fresh: suite.endToEnd[kind].fresh,
        sampling: suite.endToEnd[kind].sampling,
      },
    })
    results["end-to-end:baseline"] = await measureGroup({
      group: "end-to-end:baseline",
      area: "end-to-end",
      tiers,
      unit,
      ...side("baseline"),
      sampling,
      onProgress: options.onProgress,
    })
    results["end-to-end:with-package"] = await measureGroup({
      group: "end-to-end:with-package",
      area: "end-to-end",
      tiers,
      unit,
      ...side("withPackage"),
      sampling,
      onProgress: options.onProgress,
    })
  }

  for (const benchmark of suite.functions) {
    if (!selected(benchmark.id)) continue
    const variants = benchmark.variants?.length ? benchmark.variants : [undefined]
    const benchmarkTiers = benchmark.tiers ?? tiers
    for (const variant of variants) {
      const group = variant ? `fn:${benchmark.id}@${variant.name}` : `fn:${benchmark.id}`
      results[group] = await measureGroup({
        group,
        area: "function",
        tiers: benchmarkTiers,
        unit,
        benchmark,
        variant,
        sampling,
        onProgress: options.onProgress,
      })
    }
  }

  const analysis = analyze({ suite, results, tiers, rates: options.rates })

  // Derived: the overhead the package adds, as its own group so history/summary/page can chart and classify it.
  if (analysis.endToEnd.length > 0) {
    results["end-to-end:overhead"] = {
      area: "end-to-end",
      derived: true,
      tiers: Object.fromEntries(
        analysis.endToEnd
          .filter((row) => row.overheadMs > 0)
          .map((row) => [
            tierName(row.n),
            {
              id: `end-to-end:overhead@${tierName(row.n)}`,
              status: "completed",
              derived: true,
              inputs: { [unit]: row.n },
              durationMs: { medianMs: row.overheadMs },
            },
          ]),
      ),
    }
  }

  const finishedAt = now()
  const root = options.root ?? process.cwd()
  return {
    metadata: {
      schemaVersion: RESULTS_SCHEMA_VERSION,
      package: suite.package,
      workload: suite.workload,
      tiers,
      environment: collectEnvironment(),
      git: collectGit(root),
      bundleSizes: collectBundleSizes(root, options.bundleFiles ?? suite.package.bundleFiles ?? []),
      costRates: { ...DEFAULT_RATES, ...options.rates },
      timing: {
        startedAtUtc: startedAt.toISOString(),
        finishedAtUtc: finishedAt.toISOString(),
        totalSuiteDurationMs: finishedAt.getTime() - startedAt.getTime(),
      },
      generatedBy: process.env["CI"] ? "ci" : "npm run benchmark",
      versions: {
        ...(suite.package.version ? { [suite.package.name]: suite.package.version } : {}),
      },
    },
    results,
    analysis,
  }
}

/**
 * Derives the three analyses from raw measurements. Pure; exported for direct testing.
 * @param {{ suite: object, results: object, tiers: readonly number[], rates?: object }} input - the suite, its raw `results`, the tiers measured.
 * @returns {{ complexity: object, endToEnd: object[], contribution: object[], cost: object }} the analyses.
 */
export function analyze({ suite, results, tiers, rates }) {
  const complexity = {}
  for (const [group, value] of Object.entries(results)) {
    if (value.derived) continue
    const classification = classifyGroup(measurementsOf(value))
    const documented =
      value.area === "function"
        ? suite.functions.find((fn) => group === `fn:${fn.id}` || group.startsWith(`fn:${fn.id}@`))
        : undefined
    const variantName = documented ? group.slice(`fn:${documented.id}`.length + 1) : ""
    const variant = documented?.variants?.find((candidate) => candidate.name === variantName)
    const expected = documented ? expectationOf(documented, variant).expectedComplexity : undefined
    complexity[group] = {
      class: classification.complexityClass,
      exponent: classification.exponent,
      notation: classification.complexityClass
        ? COMPLEXITY_NOTATION[classification.complexityClass]
        : null,
      points: classification.points,
      ...(expected
        ? {
            expected,
            expectedNotation: COMPLEXITY_NOTATION[expected],
            agreement: agreement(classification.complexityClass, expected),
          }
        : {}),
    }
  }

  const baseline = results["end-to-end:baseline"]
  const withPackage = results["end-to-end:with-package"]
  const endToEnd = []
  for (const n of tiers) {
    const base = completedAt(baseline, n)
    const full = completedAt(withPackage, n)
    if (!base || !full) continue
    const overheadMs = Math.max(0, full.durationMs.medianMs - base.durationMs.medianMs)
    const overheadCpuMs = Math.max(0, full.cpuMs.medianMs - base.cpuMs.medianMs)
    const heapBytes = Math.max(0, full.heapDeltaBytes - base.heapDeltaBytes)
    endToEnd.push({
      n,
      baselineMs: base.durationMs.medianMs,
      withPackageMs: full.durationMs.medianMs,
      overheadMs,
      overheadPercent:
        base.durationMs.medianMs > 0 ? (overheadMs / base.durationMs.medianMs) * 100 : null,
      overheadCpuMs,
      overheadHeapBytes: heapBytes,
      cost: estimateCost({ wallMs: overheadMs, cpuMs: overheadCpuMs, heapBytes }, rates),
    })
  }

  const contribution = []
  for (const fn of suite.functions) {
    if (!fn.inEndToEnd) continue
    const variant = fn.inEndToEnd.variant ?? fn.variants?.[0]?.name
    const group = variant ? `fn:${fn.id}@${variant}` : `fn:${fn.id}`
    const rows = []
    for (const row of endToEnd) {
      const entry = completedAt(results[group], row.n)
      if (!entry) continue
      const calls =
        typeof fn.inEndToEnd.callsPerOperation === "function"
          ? fn.inEndToEnd.callsPerOperation(row.n)
          : fn.inEndToEnd.callsPerOperation
      const estimatedMs = entry.durationMs.medianMs * calls
      rows.push({
        n: row.n,
        calls,
        estimatedMs,
        shareOfOverhead: row.overheadMs > 0 ? estimatedMs / row.overheadMs : null,
        shareOfTotal: row.withPackageMs > 0 ? estimatedMs / row.withPackageMs : null,
      })
    }
    contribution.push({ id: fn.id, group, description: fn.inEndToEnd.description, rows })
  }

  // The tier nearest the declared typical size (a quick run may not include it).
  const typical = [...endToEnd].sort(
    (a, b) => Math.abs(a.n - suite.workload.typicalN) - Math.abs(b.n - suite.workload.typicalN),
  )[0]
  const typicalN =
    typical?.n ??
    [...tiers].sort(
      (a, b) => Math.abs(a - suite.workload.typicalN) - Math.abs(b - suite.workload.typicalN),
    )[0] ??
    suite.workload.typicalN
  const largest = endToEnd[endToEnd.length - 1]
  return { complexity, endToEnd, contribution, cost: { typicalN, typical, largest } }
}
