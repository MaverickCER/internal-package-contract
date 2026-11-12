// Runs a defined suite and produces the results object. It holds raw per-tier measurements for every group,
// plus an `analysis` section that turns those measurements into what the checks and reports read:
//   1. endToEnd     -- what adopting the package adds to one operation, at every size
//   2. complexity   -- how each group scales, and whether that matches its documented big-O (`agreement`)
//   3. contribution -- which functions make up the end-to-end operation, and how much time each is
//                      responsible for (nested calls counted once, against the operation's total)
//   4. cost         -- the estimated price at the typical and the largest size
//   5. coverage     -- what each benchmark covers of the public functions, which `BenchmarkCoverage` reads
//
// Every group varies one variable: the suite's unit, or one other variable with the rest held at base values.
// So each group has one growth class. `agreement` calls neighbouring classes "close" and two or more apart
// "differs"; only "differs" fails the complexity gate (gates.mjs). `--quick` swaps in `QUICK_TIERS` and short
// sampling, for a smoke test and not for results that are committed.

import { classifyGroup, MIN_R_SQUARED } from "../classify-complexity.mjs"
import { estimateCost, DEFAULT_RATES } from "./cost-model.mjs"
import { collectBundleSizes, collectEnvironment, collectGit } from "./environment.mjs"
import { computeDurationStats, computePairedStats, sample, samplePaired } from "./measure.mjs"
import { COMPLEXITY_NOTATION, expectationOf, groupName, parseGroup } from "./define.mjs"
import { QUICK_TIERS, tierName } from "./tiers.mjs"

export const RESULTS_SCHEMA_VERSION = 4

const CLASS_ORDER = Object.keys(COMPLEXITY_NOTATION)

/**
 * Which process produced a results file: the workflow and run in CI (so a number can be traced back to
 * the job that measured it), else the local command.
 * @param {Record<string, string | undefined>} env
 * @returns {string}
 */
export function generatedBy(env) {
  if (!env["CI"]) return "npm run benchmark"
  const workflow = env["GITHUB_WORKFLOW"]
  const run = env["GITHUB_RUN_ID"]
  return workflow && run ? `ci: ${workflow} (run ${run})` : "ci"
}

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

async function measureTier({ n, unit, held, setup, run, teardown, fresh, sampling, group }) {
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
      ...heldField(held),
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

/**
 * Pairs to take at the suite's typical size, at least: the overhead gate judges that tier, and a
 * confidence interval on a handful of pairs is wide enough to hide a real regression.
 */
const TYPICAL_MIN_PAIRS = 10

/**
 * Measures the end-to-end pair tier by tier with {@link samplePaired}: baseline and with-package
 * samples interleaved, so the per-pair difference -- the package's overhead -- carries the run's
 * drift on neither side, and comes with a confidence interval. The two groups keep the shape a
 * separately measured group has; the with-package tier also records the paired statistics.
 * @param {{ tiers: readonly number[], unit: string, suite: object, sampling: object, onProgress?: (line: string) => void }} input
 * @returns {Promise<{ baseline: object, withPackage: object }>} the two groups.
 */
async function measureEndToEndPair({ tiers, unit, suite, sampling, onProgress }) {
  const groups = { baseline: {}, withPackage: {} }
  const names = { baseline: "end-to-end:baseline", withPackage: "end-to-end:with-package" }
  for (const n of tiers) {
    onProgress?.(`${names.baseline} n=${String(n)}`)
    onProgress?.(`${names.withPackage} n=${String(n)}`)
    const ctx = {}
    const sides = {}
    try {
      for (const key of ["baseline", "withPackage"]) {
        const side = suite.endToEnd[key]
        const build = async () => {
          ctx[key] = side.setup ? await side.setup(n) : undefined
        }
        const own = side.sampling?.instruments ? { instruments: side.sampling.instruments } : {}
        if (side.fresh === true) {
          sides[key] = {
            run: () => side.run(ctx[key]),
            prepare: build,
            release: async () => side.teardown?.(ctx[key]),
            ...own,
          }
        } else {
          await build()
          sides[key] = { run: () => side.run(ctx[key]), ...own }
        }
      }
      const options = {
        ...sampling,
        ...(suite.endToEnd.baseline.sampling ?? {}),
        ...(suite.endToEnd.withPackage.sampling ?? {}),
      }
      if (n === suite.workload.typicalN) {
        options.minIterations = Math.max(options.minIterations ?? 0, TYPICAL_MIN_PAIRS)
      }
      const raw = await samplePaired({ a: sides.baseline, b: sides.withPackage }, options)
      const entry = (group, data, extra) => {
        const durationMs = computeDurationStats(data.wallMs, raw.configuration.warmupIterations)
        return {
          id: `${group}@${tierName(n)}`,
          status: "completed",
          inputs: { [unit]: n },
          durationMs,
          cpuMs: computeDurationStats(data.cpuMs, raw.configuration.warmupIterations),
          heapDeltaBytes: median(data.heapDeltaBytes),
          opsPerSecond: durationMs.medianMs > 0 ? 1000 / durationMs.medianMs : null,
          configuration: raw.configuration,
          ...extra,
        }
      }
      groups.baseline[tierName(n)] = entry(names.baseline, raw.a, {})
      groups.withPackage[tierName(n)] = entry(names.withPackage, raw.b, {
        paired: computePairedStats(raw.differenceMs),
      })
    } catch (error) {
      for (const key of ["baseline", "withPackage"]) {
        groups[key][tierName(n)] = {
          id: `${names[key]}@${tierName(n)}`,
          status: "failed",
          inputs: { [unit]: n },
          error: { name: error?.name ?? "Error", message: String(error?.message ?? error) },
        }
      }
    } finally {
      for (const key of ["baseline", "withPackage"]) {
        if (suite.endToEnd[key].fresh !== true) await suite.endToEnd[key].teardown?.(ctx[key])
      }
    }
  }
  return {
    baseline: { area: "end-to-end", tiers: groups.baseline },
    withPackage: { area: "end-to-end", tiers: groups.withPackage },
  }
}

/** @param {Record<string, number>} held @returns {{ held?: Record<string, number> }} the field, only when another variable was held. */
function heldField(held) {
  return Object.keys(held).length > 0 ? { held } : {}
}

/**
 * The value of every swept variable at one measurement: the one being swept at `n`, the others held at
 * their base values (the suite's unit at `primaryValue`).
 * @param {{ suiteUnit: string, variable: string, primaryValue: number, benchmark: object }} context
 * @param {number} n - the size of the variable being swept.
 * @returns {Record<string, number>} every variable's value.
 */
export function valuesAt({ suiteUnit, variable, primaryValue, benchmark }, n) {
  const values = { [suiteUnit]: primaryValue }
  for (const sweep of benchmark.sweeps ?? []) values[sweep.variable] = sweep.baseValue
  values[variable] = n
  return values
}

/**
 * @param {object | undefined} context - see {@link valuesAt}; `undefined` for a group with one variable.
 * @param {string} variable - the variable being swept.
 * @param {number} n
 * @returns {Record<string, number>} the values of every other variable at this size.
 */
function heldAt(context, variable, n) {
  return Object.fromEntries(
    Object.entries(valuesAt(context, n)).filter(([name]) => name !== variable),
  )
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
  context,
}) {
  const entries = {}
  for (const n of tiers) {
    onProgress?.(`${group} n=${String(n)}`)
    try {
      entries[tierName(n)] = await measureTier({
        n,
        unit,
        held: heldAt(context, unit, n),
        group,
        setup: benchmark.setup
          ? (size) =>
              benchmark.setup(size, variant?.options, {
                variable: unit,
                values: valuesAt(context, size),
              })
          : undefined,
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
        ...heldField(heldAt(context, unit, n)),
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
  const entry = group?.tiers[tierName(n)]
  return entry?.status === "completed" ? entry : undefined
}

/**
 * @param {object} suite - a suite returned by defineSuite.
 * @param {{ quick?: boolean, only?: readonly string[], sampling?: object, rates?: object, root?: string, bundleFiles?: readonly string[], onProgress?: (message: string) => void, now?: () => Date }} [options] - run controls.
 * @returns {Promise<object>} the complete results object (schema version 4).
 */
export async function runSuite(suite, options = {}) {
  const now = options.now ?? (() => new Date())
  const startedAt = now()
  const tiers = options.tiers ?? (options.quick ? QUICK_TIERS : suite.tiers)
  const unit = suite.workload.unit
  const sampling =
    options.sampling ?? (options.quick ? { targetDurationMs: 80, maxIterations: 20 } : {})
  const selected = (id) => !options.only || options.only.length === 0 || options.only.includes(id)
  const results = {}

  if (selected("end-to-end")) {
    const pair = await measureEndToEndPair({
      tiers,
      unit,
      suite,
      sampling,
      onProgress: options.onProgress,
    })
    results["end-to-end:baseline"] = pair.baseline
    results["end-to-end:with-package"] = pair.withPackage
  }

  for (const benchmark of suite.functions) {
    if (!selected(benchmark.id)) continue
    const variants = benchmark.variants?.length ? benchmark.variants : [undefined]
    const benchmarkTiers = benchmark.tiers ?? tiers
    for (const variant of variants) {
      // The suite's own unit first, then each other variable the function declares, one at a time with the
      // rest held at their base values, so every group has exactly one variable and one growth class.
      const sweeps = [
        { variable: unit, tiers: benchmarkTiers, primaryValue: suite.workload.typicalN },
        ...(benchmark.sweeps ?? []).map((sweep) => ({
          variable: sweep.variable,
          tiers: sweep.tiers ?? benchmarkTiers,
          primaryValue: sweep.primaryValue ?? suite.workload.typicalN,
        })),
      ]
      for (const { variable, tiers: ladder, primaryValue } of sweeps) {
        const group = groupName(
          benchmark.id,
          variant?.name,
          variable === unit ? undefined : variable,
        )
        results[group] = await measureGroup({
          group,
          area: "function",
          tiers: ladder,
          unit: variable,
          benchmark,
          variant,
          sampling,
          onProgress: options.onProgress,
          context: { suiteUnit: unit, variable, primaryValue, benchmark },
        })
      }
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
      generatedBy: generatedBy(process.env),
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
 * @returns {{ complexity: object, endToEnd: object[], contribution: object[], cost: object, coverage: object }} the analyses.
 */
export function analyze({ suite, results, tiers, rates }) {
  const complexity = {}
  for (const [group, value] of Object.entries(results)) {
    if (value.derived) continue
    const classification = classifyGroup(measurementsOf(value))
    const parts = parseGroup(group)
    const documented = parts && suite.functions.find((fn) => fn.id === parts.id)
    const variant = documented?.variants?.find((candidate) => candidate.name === parts.variant)
    const expected = documented
      ? expectationOf(documented, variant, parts.variable).expectedComplexity
      : undefined
    const unmeasured = Object.entries(value.tiers)
      .filter(([, entry]) => entry.status !== "completed")
      .map(([tier, entry]) => ({
        tier,
        status: entry.status,
        ...((entry.error?.message ?? entry.reason)
          ? { message: entry.error?.message ?? entry.reason }
          : {}),
      }))
    complexity[group] = {
      class: classification.complexityClass,
      exponent: classification.exponent,
      rSquared: classification.rSquared ?? null,
      ...(classification.reason ? { reason: classification.reason } : {}),
      variable: parts?.variable ?? suite.workload.unit,
      ...(classification.reason === "insufficient-data" && classification.discarded.length > 0
        ? { discarded: classification.discarded }
        : {}),
      ...(classification.size === undefined ? {} : { size: classification.size }),
      ...(unmeasured.length > 0 ? { unmeasured } : {}),
      ...(classification.reason === "poor-fit" ? { minRSquared: MIN_R_SQUARED } : {}),
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

  // What the suite says it covers of the package's public functions, so a check can compare it with the API
  // without importing the suite.
  const coverage = {
    benchmarks: suite.functions
      .filter((fn) => fn.covers !== undefined)
      .map((fn) => ({ id: fn.id, covers: fn.covers })),
    notBenchmarked: suite.notBenchmarked ?? {},
  }

  const baseline = results["end-to-end:baseline"]
  const withPackage = results["end-to-end:with-package"]
  const endToEnd = []
  for (const n of tiers) {
    const base = completedAt(baseline, n)
    const full = completedAt(withPackage, n)
    if (!base || !full) continue
    // Paired samples give the overhead directly, as the median per-pair difference with its own
    // interval; a results file measured before pairing falls back to the difference of two medians.
    const paired = full.paired
    const overheadMs = Math.max(
      0,
      paired ? paired.medianMs : full.durationMs.medianMs - base.durationMs.medianMs,
    )
    const overheadCpuMs = Math.max(0, full.cpuMs.medianMs - base.cpuMs.medianMs)
    const heapBytes = Math.max(0, full.heapDeltaBytes - base.heapDeltaBytes)
    const baselineMs = base.durationMs.medianMs
    const ci95Ms = typeof paired?.ci95Ms === "number" ? paired.ci95Ms : null
    endToEnd.push({
      n,
      baselineMs,
      withPackageMs: full.durationMs.medianMs,
      overheadMs,
      overheadPercent: baselineMs > 0 ? (overheadMs / baselineMs) * 100 : null,
      overheadCi95Ms: ci95Ms,
      overheadCi95Percent: ci95Ms !== null && baselineMs > 0 ? (ci95Ms / baselineMs) * 100 : null,
      pairs: paired?.pairs ?? null,
      overheadCpuMs,
      overheadHeapBytes: heapBytes,
      cost: estimateCost({ wallMs: overheadMs, cpuMs: overheadCpuMs, heapBytes }, rates),
    })
  }

  // What each function costs per operation (its own measured time x how often one operation calls
  // it). A function measured on its own includes everything it calls, so a function that calls
  // another attributed one names it in `inEndToEnd.includes` and the nested time is subtracted from
  // it: every moment of the operation is then attributed to at most one function, and the shares are
  // measured against the operation's total -- a figure measured directly -- never against the
  // difference of two medians, which is noisy and can be zero or negative.
  const inclusive = new Map()
  for (const fn of suite.functions) {
    if (!fn.inEndToEnd) continue
    const variant = fn.inEndToEnd.variant ?? fn.variants?.[0]?.name
    const group = variant ? `fn:${fn.id}@${variant}` : `fn:${fn.id}`
    const rows = new Map()
    for (const row of endToEnd) {
      const entry = completedAt(results[group], row.n)
      if (!entry) continue
      const calls =
        typeof fn.inEndToEnd.callsPerOperation === "function"
          ? fn.inEndToEnd.callsPerOperation(row.n)
          : fn.inEndToEnd.callsPerOperation
      rows.set(row.n, {
        calls,
        estimatedMs: entry.durationMs.medianMs * calls,
        withPackageMs: row.withPackageMs,
      })
    }
    inclusive.set(fn.id, { fn, group, rows })
  }
  const contribution = []
  for (const { fn, group, rows } of inclusive.values()) {
    const out = []
    for (const [n, { calls, estimatedMs, withPackageMs }] of rows) {
      // Stryker disable next-line ArrayDeclaration: the mutant lists an id no function has, which adds nothing
      const nested = (fn.inEndToEnd.includes ?? []).reduce(
        (sum, id) => sum + (inclusive.get(id)?.rows.get(n)?.estimatedMs ?? 0),
        0,
      )
      const exclusiveMs = Math.max(0, estimatedMs - nested)
      out.push({
        n,
        calls,
        estimatedMs,
        exclusiveMs,
        shareOfTotal: withPackageMs > 0 ? exclusiveMs / withPackageMs : null,
      })
    }
    contribution.push({ id: fn.id, group, description: fn.inEndToEnd.description, rows: out })
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
  return { complexity, endToEnd, contribution, cost: { typicalN, typical, largest }, coverage }
}
