// Runs a defined suite and produces the results object: raw per-tier measurements for every group
// (compatible with append-history / render-summary / render-page, which read
// `results[group].tiers[tier].durationMs.medianMs` and `inputs`), plus an `analysis` section that turns
// those measurements into the three things a platform engineer asks:
//   1. endToEnd     -- what does adopting the package add to one operation, at every size?
//   2. functions    -- how does each function scale, and does it match its documented big-O?
//   3. contribution -- which functions make up the end-to-end operation, and how much time each is
//                      responsible for (nested calls counted once, against the operation's total)?

import { classifyGroup, MIN_R_SQUARED } from "../classify-complexity.mjs"
import { estimateCost, DEFAULT_RATES } from "./cost-model.mjs"
import { collectBundleSizes, collectEnvironment, collectGit } from "./environment.mjs"
import { computeDurationStats, sample } from "./measure.mjs"
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

/** @param {Record<string, number> | undefined} held @returns {{ held?: Record<string, number> }} the field, only when another variable was held. */
function heldField(held) {
  return held !== undefined && Object.keys(held).length > 0 ? { held } : {}
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
 * @returns {Record<string, number> | undefined} the values of every other variable at this size.
 */
function heldAt(context, variable, n) {
  if (context === undefined) return undefined
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
              benchmark.setup(
                size,
                variant?.options,
                context === undefined
                  ? undefined
                  : { variable: unit, values: valuesAt(context, size) },
              )
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
