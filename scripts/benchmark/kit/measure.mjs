// Timing and memory sampling. Pure Node builtins; no dependency on any package under test.
//
// Every sample records three things, because they answer three different cost questions:
//   - wall time   -- what a caller waits (latency; also what serverless platforms bill for)
//   - CPU time    -- what the machine actually works (what a CPU-priced platform bills for)
//   - heap delta  -- how much memory the operation leaves retained / allocates (memory pressure)

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
  const mean = count > 0 ? sorted.reduce((sum, value) => sum + value, 0) / count : 0
  const variance =
    count > 0 ? sorted.reduce((sum, value) => sum + (value - mean) ** 2, 0) / count : 0
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
 * @param {{ warmupIterations?: number, targetDurationMs?: number, minIterations?: number, maxIterations?: number, minSampleMs?: number, prepare?: () => unknown, release?: () => unknown }} [options] - `prepare`/`release` run untimed around every sample (fresh state per sample).
 * @returns {Promise<{ wallMs: number[], cpuMs: number[], heapDeltaBytes: number[], configuration: object }>} per-operation values, one per sample.
 */
export async function sample(iteration, options = {}) {
  const warmupIterations = options.warmupIterations ?? 2
  const targetDurationMs = options.targetDurationMs ?? 300
  const minIterations = options.minIterations ?? 5
  const maxIterations = options.maxIterations ?? 60
  const minSampleMs = options.minSampleMs ?? 1
  const gc = typeof global.gc === "function" ? global.gc : undefined
  let batch = 1
  const batchable = options.prepare === undefined

  const once = async () => {
    await options.prepare?.()
    gc?.()
    const heapBefore = process.memoryUsage().heapUsed
    const cpuBefore = process.cpuUsage()
    const start = performance.now()
    let returned
    for (let repetition = 0; repetition < batch; repetition += 1) returned = await iteration()
    const wall = performance.now() - start
    const cpu = process.cpuUsage(cpuBefore)
    const reportedMs =
      batch === 1 &&
      typeof returned === "object" &&
      returned !== null &&
      TIMED in returned &&
      Number.isFinite(returned[TIMED])
        ? returned[TIMED]
        : undefined
    const heapAfter = process.memoryUsage().heapUsed
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

  let calibration = { raw: 0 }
  for (let index = 0; index < warmupIterations; index += 1) calibration = await once()
  if (batchable && calibration.raw > 0 && calibration.raw < minSampleMs) {
    batch = Math.min(MAX_BATCH, Math.ceil(minSampleMs / calibration.raw))
    await once()
  }

  const wallMs = []
  const cpuMs = []
  const heapDeltaBytes = []
  const startedAt = performance.now()
  while (
    wallMs.length < maxIterations &&
    (wallMs.length < minIterations || performance.now() - startedAt < targetDurationMs)
  ) {
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
