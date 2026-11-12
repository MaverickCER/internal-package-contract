// Timing and memory sampling. Node builtins only; nothing under test is imported.
//
// Every sample records three things, because they answer three different cost questions:
//   - wall time   -- what a caller waits (latency; what duration-priced platforms bill for)
//   - CPU time    -- what the machine works (what CPU-priced platforms bill for)
//   - heap delta  -- how much memory the operation leaves allocated
//
// Operations too fast for the clock to resolve are repeated inside one sample and divided back out. A
// sub-microsecond function still gets a usable figure that way. `global.gc()` runs before each counted sample
// when Node was started with `--expose-gc`, which run-suite.mjs arranges.

/** @returns {{ rssBytes: number, heapUsedBytes: number }} a snapshot of this process's memory. */
export function snapshotMemory() {
  const memory = process.memoryUsage()
  return { rssBytes: memory.rss, heapUsedBytes: memory.heapUsed }
}

/**
 * @param {readonly number[]} sorted - ascending values.
 * @param {number} p - percentile in 0..1.
 * @returns {number} the nearest-rank percentile (0 for an empty list).
 */
export function percentile(sorted, p) {
  if (sorted.length === 0) return 0
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]
}

/**
 * @param {readonly number[]} values - raw per-iteration values.
 * @param {number} warmupIterations - how many discarded warmup runs preceded them.
 * @returns {{ minMs: number, medianMs: number, p95Ms: number, maxMs: number, stdDevMs: number, iterations: number, warmupIterations: number }}
 */
export function computeDurationStats(values, warmupIterations) {
  const sorted = [...values].sort((a, b) => a - b)
  const count = sorted.length
  // An empty list divides by 1, not 0: its sums are 0, so its mean and variance are 0, not NaN.
  const divisor = count || 1
  const mean = sorted.reduce((sum, value) => sum + value, 0) / divisor
  const variance = sorted.reduce((sum, value) => sum + (value - mean) ** 2, 0) / divisor
  return {
    minMs: sorted[0] ?? 0,
    medianMs: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    maxMs: sorted[count - 1] ?? 0,
    stdDevMs: Math.sqrt(variance),
    iterations: count,
    warmupIterations,
  }
}

const TIMED = Symbol.for("internal-package-contract.benchmark.timed")

/**
 * Lets an operation report its OWN duration (for work timed elsewhere, such as a child process whose
 * start-to-finish time the parent measures). Return `timed(ms)` from `run`; any other return value --
 * numbers included -- is just a result and never read as a time.
 * @param {number} ms - the duration to record, in milliseconds.
 * @returns {object} a marker the sampler recognizes.
 */
export function timed(ms) {
  return { [TIMED]: ms }
}

/** Upper bound on how many back-to-back repetitions one sample may be batched into. */
const MAX_BATCH = 100_000

/**
 * @typedef {object} Instruments
 * @property {() => number} now - a high-resolution clock in milliseconds.
 * @property {(previous?: { user: number, system: number }) => { user: number, system: number }} cpuUsage - CPU time in microseconds, since `previous` when given.
 * @property {() => number} heapUsed - bytes of heap in use.
 * @property {(() => void) | undefined} gc - forces a collection, when node was started with `--expose-gc`.
 */

/** @returns {Instruments} the real clock, CPU counter, heap gauge and collector of this process. */
function realInstruments() {
  return {
    now: () => performance.now(),
    cpuUsage: (previous) => process.cpuUsage(previous),
    heapUsed: () => process.memoryUsage().heapUsed,
    gc: typeof global.gc === "function" ? global.gc : undefined,
  }
}

/**
 * Samples `iteration` repeatedly: `warmupIterations` discarded runs, then counted samples until
 * `targetDurationMs` of wall time has elapsed or `maxIterations` is reached, never fewer than
 * `minIterations`. Calls `global.gc()` before each counted sample when node was started with
 * `--expose-gc`, so one sample's garbage is not billed to the next.
 *
 * Operations faster than `minSampleMs` are far below what `performance.now()` and
 * `process.cpuUsage()` can resolve, so they are repeated back to back inside one sample (the batch
 * size is calibrated during warmup) and each reported value is divided by the batch size. Batching is
 * off when `prepare` is given (fresh state per sample cannot be repeated) or when the operation
 * reports its own time with {@link timed}.
 * @param {() => unknown} iteration - one operation; may be async. Return `timed(ms)` to record a duration measured elsewhere; any other returned value (numbers included) is kept alive so the engine cannot optimize the work away.
 * @param {{ warmupIterations?: number, targetDurationMs?: number, minIterations?: number, maxIterations?: number, minSampleMs?: number, prepare?: () => unknown, release?: () => unknown, instruments?: Instruments }} [options] - `prepare`/`release` run untimed around every sample (fresh state per sample); `instruments` replaces the real clock and gauges (for tests).
 * @returns {Promise<{ wallMs: number[], cpuMs: number[], heapDeltaBytes: number[], configuration: object }>} per-operation values, one per sample.
 */
export async function sample(iteration, options = {}) {
  const warmupIterations = options.warmupIterations ?? 2
  const targetDurationMs = options.targetDurationMs ?? 300
  const minIterations = options.minIterations ?? 5
  const maxIterations = options.maxIterations ?? 60
  const minSampleMs = options.minSampleMs ?? 1
  const { now, cpuUsage, heapUsed, gc } = options.instruments ?? realInstruments()
  let batch = 1
  const batchable = options.prepare === undefined

  const once = async () => {
    await options.prepare?.()
    gc?.()
    const heapBefore = heapUsed()
    const cpuBefore = cpuUsage()
    const start = now()
    let returned
    // Counted by `Array(batch)`'s own length rather than a counter variable: there is no
    // increment to get wrong, so a loop that never ends is not something this code can do.
    for (const repetition of Array(batch).keys()) {
      void repetition
      returned = await iteration()
    }
    const wall = now() - start
    const cpu = cpuUsage(cpuBefore)
    const reportedMs =
      batch === 1 &&
      typeof returned === "object" &&
      returned !== null &&
      TIMED in returned &&
      Number.isFinite(returned[TIMED])
        ? returned[TIMED]
        : undefined
    const heapAfter = heapUsed()
    // Keep the last result reachable so the work cannot be dead-code-eliminated.
    globalThis["__benchmarkSink"] = returned
    await options.release?.()
    return {
      wallMs: reportedMs ?? wall / batch,
      cpuMs: (cpu.user + cpu.system) / 1000 / batch,
      heapDeltaBytes: (heapAfter - heapBefore) / batch,
      raw: wall,
    }
  }

  let calibrationMs = 0
  for (const warmup of Array(warmupIterations).keys()) {
    void warmup
    calibrationMs = (await once()).raw
  }
  if (batchable && calibrationMs > 0 && calibrationMs < minSampleMs) {
    batch = Math.min(MAX_BATCH, Math.ceil(minSampleMs / calibrationMs))
    await once()
  }

  const wallMs = []
  const cpuMs = []
  const heapDeltaBytes = []
  const startedAt = now()
  for (const taken of Array(maxIterations).keys()) {
    // Past `minIterations` samples, stop once the time budget is spent.
    if (taken >= minIterations && now() - startedAt >= targetDurationMs) break
    const result = await once()
    wallMs.push(result.wallMs)
    cpuMs.push(result.cpuMs)
    heapDeltaBytes.push(result.heapDeltaBytes)
  }

  return {
    wallMs,
    cpuMs,
    heapDeltaBytes,
    configuration: {
      targetDurationMs,
      minIterations,
      maxIterations,
      warmupIterations,
      minSampleMs,
      batchSize: batch,
      gcEnabled: Boolean(gc),
    },
  }
}

/**
 * Two-sided 95% Student t quantiles by degrees of freedom 1..30; the normal quantile past that.
 * Used for the confidence interval of a paired difference, where the sample is small by design.
 */
const T95 = [
  12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.16, 2.145,
  2.131, 2.12, 2.11, 2.101, 2.093, 2.086, 2.08, 2.074, 2.069, 2.064, 2.06, 2.056, 2.052, 2.048,
  2.045, 2.042,
]

/**
 * @param {readonly number[]} differences - one per pair: the second side's time minus the first's.
 * @returns {{ pairs: number, medianMs: number, meanMs: number, stdDevMs: number, ci95Ms: number | null }}
 *   the paired difference's median and mean, its sample standard deviation, and the half-width of
 *   its 95% confidence interval (`null` below two pairs, where no interval exists).
 */
export function computePairedStats(differences) {
  const sorted = [...differences].sort((a, b) => a - b)
  const pairs = sorted.length
  const mean = sorted.reduce((sum, value) => sum + value, 0) / (pairs || 1)
  // The sample variance (n - 1): the mean was estimated from the same pairs.
  const variance =
    pairs > 1 ? sorted.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (pairs - 1) : 0
  const stdDevMs = Math.sqrt(variance)
  const t = pairs > 1 ? (T95[pairs - 2] ?? 1.96) : null
  return {
    pairs,
    medianMs: percentile(sorted, 0.5),
    meanMs: mean,
    stdDevMs,
    ci95Ms: t === null ? null : (t * stdDevMs) / Math.sqrt(pairs),
  }
}

/**
 * @typedef {object} PairedSide
 * @property {() => unknown} run - one operation; may be async; may return `timed(ms)`.
 * @property {() => unknown} [prepare] - runs untimed before every sample of this side.
 * @property {() => unknown} [release] - runs untimed after every sample of this side.
 * @property {Instruments} [instruments] - this side's own clock and gauges (for tests); the shared ones otherwise.
 */

/**
 * Samples two operations interleaved, A B then B A then A B ..., so a drift in the machine over the
 * run (a boost clock, a thermal limit, a neighbour on the runner) lands on both sides alike and the
 * per-pair difference carries only what distinguishes them. The difference is the figure to judge
 * when the two sides are close: two separately sampled medians put their noise on top of each
 * other, a pair subtracts it. No batching: this is for operations long enough to time on their own.
 * @param {{ a: PairedSide, b: PairedSide }} sides - the two operations.
 * @param {{ warmupIterations?: number, targetDurationMs?: number, minIterations?: number, maxIterations?: number, instruments?: Instruments }} [options] - counts are in pairs; one warmup pair by default.
 * @returns {Promise<{ a: { wallMs: number[], cpuMs: number[], heapDeltaBytes: number[] }, b: { wallMs: number[], cpuMs: number[], heapDeltaBytes: number[] }, differenceMs: number[], configuration: object }>}
 *   per-pair values for each side, the per-pair difference (b minus a) and how the sampling was configured.
 */
export async function samplePaired(sides, options = {}) {
  const warmupIterations = options.warmupIterations ?? 1
  const targetDurationMs = options.targetDurationMs ?? 300
  const minIterations = options.minIterations ?? 5
  const maxIterations = options.maxIterations ?? 60
  const shared = options.instruments ?? realInstruments()

  const once = async (side) => {
    const { now, cpuUsage, heapUsed, gc } = side.instruments ?? shared
    await side.prepare?.()
    gc?.()
    const heapBefore = heapUsed()
    const cpuBefore = cpuUsage()
    const start = now()
    const returned = await side.run()
    const wall = now() - start
    const cpu = cpuUsage(cpuBefore)
    const heapAfter = heapUsed()
    globalThis["__benchmarkSink"] = returned
    await side.release?.()
    const reportedMs =
      typeof returned === "object" &&
      returned !== null &&
      TIMED in returned &&
      Number.isFinite(returned[TIMED])
        ? returned[TIMED]
        : undefined
    return {
      wallMs: reportedMs ?? wall,
      cpuMs: (cpu.user + cpu.system) / 1000,
      heapDeltaBytes: heapAfter - heapBefore,
    }
  }

  for (const warmup of Array(warmupIterations).keys()) {
    void warmup
    await once(sides.a)
    await once(sides.b)
  }

  const a = { wallMs: [], cpuMs: [], heapDeltaBytes: [] }
  const b = { wallMs: [], cpuMs: [], heapDeltaBytes: [] }
  const differenceMs = []
  const startedAt = shared.now()
  for (const pair of Array(maxIterations).keys()) {
    if (pair >= minIterations && shared.now() - startedAt >= targetDurationMs) break
    // Every second pair runs in the opposite order, so a steady drift favours neither side.
    const order = pair % 2 === 0 ? ["a", "b"] : ["b", "a"]
    const taken = {}
    for (const key of order) taken[key] = await once(sides[key])
    for (const [key, into] of [
      ["a", a],
      ["b", b],
    ]) {
      into.wallMs.push(taken[key].wallMs)
      into.cpuMs.push(taken[key].cpuMs)
      into.heapDeltaBytes.push(taken[key].heapDeltaBytes)
    }
    differenceMs.push(taken.b.wallMs - taken.a.wallMs)
  }

  return {
    a,
    b,
    differenceMs,
    configuration: {
      targetDurationMs,
      minIterations,
      maxIterations,
      warmupIterations,
      interleaved: "abba",
      gcEnabled: Boolean(shared.gc),
    },
  }
}
