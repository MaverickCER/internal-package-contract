import { afterEach, describe, expect, it } from "vitest"
import {
  computeDurationStats,
  percentile,
  sample,
  snapshotMemory,
  timed,
} from "../scripts/benchmark/kit/index.mjs"

type Options = NonNullable<Parameters<typeof sample>[1]>
type Instruments = NonNullable<Options["instruments"]>

/**
 * Instruments whose clock advances `step` milliseconds on every reading, so the time a sample takes
 * is fixed by how many readings it makes, not by the machine running the test.
 */
function instruments(step: number, extra: { gc?: () => void } = {}): Instruments {
  let time = 0
  let heapReads = 0
  let readings = 0
  return {
    now: () => {
      readings += 1
      if (readings > 3_000_000) throw new Error("runaway sampler")
      return (time += step)
    },
    cpuUsage: (previous) =>
      previous === undefined ? { user: 0, system: 0 } : { user: 3000, system: 1000 },
    heapUsed: () => (heapReads++ % 2 === 0 ? 1000 : 1512),
    gc: extra.gc,
  }
}

/** An operation that fails the test, quickly, if a mutated sampler loops without end. */
function counting(limit = 1_000_000) {
  const state = { calls: 0 }
  return {
    state,
    run: () => {
      state.calls += 1
      if (state.calls > limit) throw new Error("runaway sampler")
      return undefined
    },
  }
}

describe("snapshotMemory()", () => {
  it("reports this process's resident and heap bytes", () => {
    const memory = snapshotMemory()
    expect(Object.keys(memory).sort()).toEqual(["heapUsedBytes", "rssBytes"])
    expect(memory.rssBytes).toBeGreaterThan(0)
    expect(memory.heapUsedBytes).toBeGreaterThan(0)
    expect(memory.rssBytes).toBeGreaterThan(memory.heapUsedBytes)
  })
})

describe("percentile()", () => {
  it("is the nearest rank, clamped to the last value, and 0 for nothing", () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    expect(percentile(values, 0)).toBe(1)
    expect(percentile(values, 0.5)).toBe(6)
    expect(percentile(values, 0.95)).toBe(10)
    expect(percentile(values, 1)).toBe(10)
    expect(percentile([7], 1)).toBe(7)
    expect(percentile([], 0.5)).toBe(0)
  })
})

describe("computeDurationStats()", () => {
  it("summarises unsorted values, with the population standard deviation", () => {
    expect(computeDurationStats([4, 2, 6, 8], 3)).toEqual({
      minMs: 2,
      medianMs: 6,
      p95Ms: 8,
      maxMs: 8,
      stdDevMs: Math.sqrt(5),
      iterations: 4,
      warmupIterations: 3,
    })
  })

  it("is all zeros for no values, never NaN", () => {
    expect(computeDurationStats([], 2)).toEqual({
      minMs: 0,
      medianMs: 0,
      p95Ms: 0,
      maxMs: 0,
      stdDevMs: 0,
      iterations: 0,
      warmupIterations: 2,
    })
  })

  it("does not reorder the caller's array", () => {
    const values = [3, 1, 2]
    computeDurationStats(values, 0)
    expect(values).toEqual([3, 1, 2])
  })
})

describe("timed()", () => {
  it("wraps a duration in a marker, not a plain number", () => {
    const marker = timed(5)
    expect(typeof marker).toBe("object")
    expect(Object.getOwnPropertySymbols(marker)).toHaveLength(1)
  })
})

describe("sample() defaults and options", () => {
  it("reports the configuration it used, with documented defaults", async () => {
    const op = counting()
    const result = await sample(op.run, { instruments: instruments(10) })
    expect(result.configuration).toEqual({
      targetDurationMs: 300,
      minIterations: 5,
      maxIterations: 60,
      warmupIterations: 2,
      minSampleMs: 1,
      batchSize: 1,
      gcEnabled: false,
    })
  })

  it("takes every option as given, zero included", async () => {
    const op = counting()
    const result = await sample(op.run, {
      warmupIterations: 0,
      targetDurationMs: 0,
      minIterations: 1,
      maxIterations: 3,
      minSampleMs: 7,
      instruments: instruments(10),
    })
    expect(result.configuration).toEqual({
      targetDurationMs: 0,
      minIterations: 1,
      maxIterations: 3,
      warmupIterations: 0,
      minSampleMs: 7,
      batchSize: 1,
      gcEnabled: false,
    })
    const nonzero = await sample(op.run, {
      warmupIterations: 1,
      targetDurationMs: 50,
      minIterations: 2,
      maxIterations: 4,
      minSampleMs: 3,
      instruments: instruments(10),
    })
    expect(nonzero.configuration).toMatchObject({
      warmupIterations: 1,
      targetDurationMs: 50,
      minIterations: 2,
      maxIterations: 4,
      minSampleMs: 3,
    })
  })
})

describe("sample() how many samples it takes", () => {
  const take = async (options: Options, step = 10) => {
    const op = counting()
    const result = await sample(op.run, {
      warmupIterations: 0,
      instruments: instruments(step),
      ...options,
    })
    return { result, calls: op.state.calls }
  }

  it("stops at maxIterations even when the time budget is far from spent", async () => {
    const { result } = await take({ minIterations: 2, maxIterations: 7, targetDurationMs: 1e9 })
    expect(result.wallMs).toHaveLength(7)
  })

  it("takes at least minIterations even when the budget is already spent", async () => {
    const { result } = await take({ minIterations: 4, maxIterations: 50, targetDurationMs: 0 })
    expect(result.wallMs).toHaveLength(4)
  })

  it("stops as soon as the elapsed time reaches the budget, not one sample later", async () => {
    // Each sample reads the clock twice and the loop once: after one sample 30ms have elapsed.
    const exact = await take({ minIterations: 1, maxIterations: 50, targetDurationMs: 30 })
    expect(exact.result.wallMs).toHaveLength(1)
    const over = await take({ minIterations: 1, maxIterations: 50, targetDurationMs: 31 })
    expect(over.result.wallMs).toHaveLength(2)
    const more = await take({ minIterations: 1, maxIterations: 50, targetDurationMs: 61 })
    expect(more.result.wallMs).toHaveLength(3)
  })

  it("keeps sampling to minIterations before it looks at the clock", async () => {
    const { result } = await take({ minIterations: 3, maxIterations: 50, targetDurationMs: 1 })
    expect(result.wallMs).toHaveLength(3)
  })

  it("runs the warmup iterations first and discards them", async () => {
    const { result, calls } = await take({
      warmupIterations: 3,
      minIterations: 2,
      maxIterations: 2,
      targetDurationMs: 0,
    })
    expect(calls).toBe(5)
    expect(result.wallMs).toHaveLength(2)
    expect(result.configuration).toMatchObject({ warmupIterations: 3 })
  })
})

describe("sample() what it records", () => {
  it("records wall time, CPU time and heap growth per sample", async () => {
    const op = counting()
    const result = await sample(op.run, {
      warmupIterations: 0,
      minIterations: 3,
      maxIterations: 3,
      instruments: instruments(10),
    })
    expect(result.wallMs).toEqual([10, 10, 10])
    expect(result.cpuMs).toEqual([4, 4, 4])
    expect(result.heapDeltaBytes).toEqual([512, 512, 512])
  })

  it("divides each reading by the batch size when a fast operation is repeated within one sample", async () => {
    const op = counting()
    const result = await sample(op.run, {
      warmupIterations: 1,
      minIterations: 2,
      maxIterations: 2,
      minSampleMs: 100,
      instruments: instruments(10),
    })
    // One warmup reads 10ms, below the 100ms minimum: batches of ceil(100 / 10) = 10.
    expect(result.configuration).toMatchObject({ batchSize: 10 })
    expect(result.wallMs).toEqual([1, 1])
    expect(result.cpuMs).toEqual([0.4, 0.4])
    expect(result.heapDeltaBytes).toEqual([51.2, 51.2])
    // 1 warmup + 1 calibrating batch of 10 + 2 samples of 10.
    expect(op.state.calls).toBe(1 + 10 + 20)
  })

  it("rounds the batch size up", async () => {
    const op = counting()
    const result = await sample(op.run, {
      warmupIterations: 1,
      minIterations: 1,
      maxIterations: 1,
      minSampleMs: 100,
      instruments: instruments(30),
    })
    expect(result.configuration).toMatchObject({ batchSize: 4 })
    expect(op.state.calls).toBe(1 + 4 + 4)
  })

  it("never batches beyond the cap", async () => {
    const op = counting()
    const result = await sample(op.run, {
      warmupIterations: 1,
      minIterations: 1,
      maxIterations: 1,
      minSampleMs: 1_000_000_000,
      instruments: instruments(0.001),
    })
    expect(result.configuration).toMatchObject({ batchSize: 100_000 })
  })

  it("does not batch an operation that already takes the minimum sample time, or has no measurable time", async () => {
    const exact = counting()
    const atMinimum = await sample(exact.run, {
      warmupIterations: 1,
      minIterations: 1,
      maxIterations: 1,
      minSampleMs: 10,
      instruments: instruments(10),
    })
    expect(atMinimum.configuration).toMatchObject({ batchSize: 1 })
    expect(exact.state.calls).toBe(2)
    const none = counting()
    const unmeasurable = await sample(none.run, {
      warmupIterations: 1,
      minIterations: 1,
      maxIterations: 1,
      minSampleMs: 10,
      instruments: instruments(0),
    })
    expect(unmeasurable.configuration).toMatchObject({ batchSize: 1 })
    expect(none.state.calls).toBe(2)
    const noWarmup = counting()
    const uncalibrated = await sample(noWarmup.run, {
      warmupIterations: 0,
      minIterations: 1,
      maxIterations: 1,
      minSampleMs: 10,
      instruments: instruments(1),
    })
    expect(uncalibrated.configuration).toMatchObject({ batchSize: 1 })
  })

  it("does not batch when a fresh state is prepared for every sample", async () => {
    const events: string[] = []
    const result = await sample(
      () => {
        events.push("run")
      },
      {
        warmupIterations: 1,
        minIterations: 2,
        maxIterations: 2,
        minSampleMs: 100,
        prepare: () => {
          events.push("prepare")
        },
        release: () => {
          events.push("release")
        },
        instruments: instruments(10),
      },
    )
    expect(result.configuration).toMatchObject({ batchSize: 1 })
    expect(events).toEqual([
      "prepare",
      "run",
      "release",
      "prepare",
      "run",
      "release",
      "prepare",
      "run",
      "release",
    ])
  })

  it("keeps the last result reachable so the work cannot be optimised away", async () => {
    const last = { marker: "last" }
    let n = 0
    await sample(() => (n++ < 2 ? { marker: "early" } : last), {
      warmupIterations: 0,
      minIterations: 3,
      maxIterations: 3,
      instruments: instruments(10),
    })
    expect((globalThis as Record<string, unknown>)["__benchmarkSink"]).toBe(last)
  })
})

describe("sample() an operation that reports its own time", () => {
  const options = (step: number): Options => ({
    warmupIterations: 0,
    minIterations: 2,
    maxIterations: 2,
    instruments: instruments(step),
  })

  it("records the reported duration instead of the measured one", async () => {
    const result = await sample(() => timed(5), options(10))
    expect(result.wallMs).toEqual([5, 5])
  })

  it("ignores a plain number, null, a non-finite duration, or an object without the marker", async () => {
    for (const returned of [
      5,
      null,
      timed(Number.NaN),
      timed(Number.POSITIVE_INFINITY),
      { x: 1 },
      "text",
    ]) {
      const result = await sample(() => returned, options(10))
      expect(result.wallMs, String(returned)).toEqual([10, 10])
    }
  })

  it("is not read when the operation is batched", async () => {
    const result = await sample(() => timed(5), {
      warmupIterations: 1,
      minIterations: 1,
      maxIterations: 1,
      minSampleMs: 100,
      instruments: instruments(10),
    })
    expect(result.configuration).toMatchObject({ batchSize: 10 })
    expect(result.wallMs).toEqual([1])
  })
})

describe("sample() garbage collection", () => {
  it("collects before every run when the collector is available, and says so", async () => {
    let collections = 0
    const result = await sample(counting().run, {
      warmupIterations: 2,
      minIterations: 3,
      maxIterations: 3,
      instruments: instruments(10, { gc: () => (collections += 1) }),
    })
    expect(collections).toBe(5)
    expect(result.configuration).toMatchObject({ gcEnabled: true })
  })

  describe("with the process's own collector", () => {
    const original = (globalThis as { gc?: unknown }).gc
    afterEach(() => {
      ;(globalThis as { gc?: unknown }).gc = original
    })

    it("uses it when node was started with --expose-gc, and reports that", async () => {
      let collections = 0
      ;(globalThis as { gc?: unknown }).gc = () => {
        collections += 1
      }
      const result = await sample(counting().run, {
        warmupIterations: 1,
        minIterations: 2,
        maxIterations: 2,
        targetDurationMs: 0,
      })
      expect(result.configuration).toMatchObject({ gcEnabled: true })
      expect(collections).toBeGreaterThanOrEqual(3)
    })

    it("runs without it, and reports that", async () => {
      ;(globalThis as { gc?: unknown }).gc = undefined
      const result = await sample(counting().run, {
        warmupIterations: 1,
        minIterations: 2,
        maxIterations: 2,
        targetDurationMs: 0,
      })
      expect(result.configuration).toMatchObject({ gcEnabled: false })
      ;(globalThis as { gc?: unknown }).gc = "not a function"
      const odd = await sample(counting().run, {
        warmupIterations: 1,
        minIterations: 2,
        maxIterations: 2,
        targetDurationMs: 0,
      })
      expect(odd.configuration).toMatchObject({ gcEnabled: false })
    })
  })

  it("measures real time with the real instruments", async () => {
    const result = await sample(counting().run, {
      warmupIterations: 1,
      minIterations: 2,
      maxIterations: 2,
      targetDurationMs: 0,
    })
    expect(result.wallMs).toHaveLength(2)
    for (const wall of result.wallMs) expect(wall).toBeGreaterThanOrEqual(0)
    for (const cpu of result.cpuMs) expect(cpu).toBeGreaterThanOrEqual(0)
    expect(result.heapDeltaBytes).toHaveLength(2)
    for (const delta of result.heapDeltaBytes) expect(Number.isFinite(delta)).toBe(true)
  })
})
