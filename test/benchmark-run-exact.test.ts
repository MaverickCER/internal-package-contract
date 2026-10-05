import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import {
  DEFAULT_RATES,
  QUICK_TIERS,
  agreement,
  analyze,
  estimateCost,
  runSuite,
} from "../scripts/benchmark/kit/index.mjs"
import { generatedBy } from "../scripts/benchmark/kit/run.mjs"

type Loose = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any -- fixtures are deliberately loose

const roots: string[] = []
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

/** Instruments whose clock advances `step` ms per reading, so every sample takes exactly `step`. */
function instruments(step: number, heapDeltas: number[] = [512]) {
  let time = 0
  let heapReads = 0
  let readings = 0
  return {
    now: () => {
      readings += 1
      if (readings > 2_000_000) throw new Error("runaway sampler")
      return (time += step)
    },
    cpuUsage: (previous?: { user: number; system: number }) =>
      previous === undefined ? { user: 0, system: 0 } : { user: 3000, system: 1000 },
    heapUsed: () => {
      const read = heapReads++
      return read % 2 === 0 ? 0 : (heapDeltas[Math.floor(read / 2) % heapDeltas.length] ?? 0)
    },
    gc: undefined,
  }
}

const SAMPLING = (step = 10, extra: Loose = {}) => ({
  warmupIterations: 0,
  minIterations: 1,
  maxIterations: 1,
  minSampleMs: 0,
  targetDurationMs: 0,
  instruments: instruments(step),
  ...extra,
})

function suiteOf(overrides: Loose = {}): Loose {
  return {
    package: { name: "demo", version: "1.2.3" },
    workload: { unit: "item", description: "One item.", typicalN: 20 },
    tiers: [20, 40],
    endToEnd: {
      purpose: "x",
      baseline: { run: () => 1 },
      withPackage: { run: () => 2 },
    },
    functions: [{ id: "sum", run: () => 3 }],
    ...overrides,
  }
}

describe("generatedBy()", () => {
  it("names the workflow and run in CI, else the local command", () => {
    expect(generatedBy({})).toBe("npm run benchmark")
    expect(generatedBy({ CI: "" })).toBe("npm run benchmark")
    expect(generatedBy({ CI: "1", GITHUB_WORKFLOW: "CI", GITHUB_RUN_ID: "9" })).toBe(
      "ci: CI (run 9)",
    )
    expect(generatedBy({ CI: "1", GITHUB_WORKFLOW: "CI" })).toBe("ci")
    expect(generatedBy({ CI: "1", GITHUB_RUN_ID: "9" })).toBe("ci")
    expect(generatedBy({ CI: "1", GITHUB_WORKFLOW: "", GITHUB_RUN_ID: "9" })).toBe("ci")
  })
})

describe("agreement()", () => {
  it("is unknown without a measured class, matches the same class, is close next door and differs further", () => {
    expect(agreement(null, "linear")).toBe("unknown")
    expect(agreement("linear", "linear")).toBe("matches")
    expect(agreement("constant", "logarithmic")).toBe("close")
    expect(agreement("logarithmic", "constant")).toBe("close")
    expect(agreement("linear", "linearithmic")).toBe("close")
    expect(agreement("constant", "linear")).toBe("differs")
    expect(agreement("cubic-or-worse", "linear")).toBe("differs")
    expect(agreement("quadratic", "cubic-or-worse")).toBe("close")
  })
})

describe("runSuite() measuring each tier", () => {
  it("records a completed entry per tier with its id, inputs and statistics", async () => {
    const results = await runSuite(
      suiteOf({ functions: [{ id: "sum", setup: (n: number) => n, run: (n: number) => n }] }),
      {
        sampling: SAMPLING(10, { instruments: instruments(10, [30]) }),
        root: process.cwd(),
      },
    )
    const entry = results.results["fn:sum"].tiers.n20
    expect(entry).toMatchObject({
      id: "fn:sum@n20",
      status: "completed",
      inputs: { item: 20 },
      heapDeltaBytes: 30,
      opsPerSecond: 100,
      configuration: { warmupIterations: 0, minIterations: 1, maxIterations: 1 },
    })
    expect(entry.durationMs).toEqual({
      minMs: 10,
      medianMs: 10,
      p95Ms: 10,
      maxMs: 10,
      stdDevMs: 0,
      iterations: 1,
      warmupIterations: 0,
    })
    expect(entry.cpuMs).toMatchObject({ medianMs: 4, iterations: 1 })
    expect(results.results["fn:sum"].area).toBe("function")
    expect(Object.keys(results.results["fn:sum"].tiers)).toEqual(["n20", "n40"])
  })

  it("takes the median heap delta, whatever order the samples came in", async () => {
    const run = async (deltas: number[]) => {
      const out = await runSuite(
        suiteOf({ functions: [{ id: "sum", run: () => 1 }], endToEnd: undefined }),
        {
          only: ["sum"],
          sampling: {
            ...SAMPLING(10, { minIterations: deltas.length, maxIterations: deltas.length }),
            instruments: instruments(10, deltas),
          },
          root: process.cwd(),
        },
      )
      return out.results["fn:sum"].tiers.n20.heapDeltaBytes as number
    }
    expect(await run([30, 10, 20])).toBe(20)
    expect(await run([40, 10, 30, 20])).toBe(30)
    expect(await run([7])).toBe(7)
  })

  it("has no throughput, and a zero heap median, when nothing was sampled", async () => {
    const results = await runSuite(suiteOf(), {
      only: ["sum"],
      sampling: SAMPLING(10, { maxIterations: 0 }),
      root: process.cwd(),
    })
    expect(results.results["fn:sum"].tiers.n20).toMatchObject({
      heapDeltaBytes: 0,
      opsPerSecond: null,
    })
    expect(results.results["fn:sum"].tiers.n20.durationMs.medianMs).toBe(0)
  })

  it("passes the context from setup to run, once per tier, and tears down after", async () => {
    const events: string[] = []
    await runSuite(
      suiteOf({
        tiers: [20],
        functions: [
          {
            id: "sum",
            setup: (n: number) => {
              events.push(`setup ${String(n)}`)
              return { n }
            },
            run: (ctx: { n: number }) => {
              events.push(`run ${String(ctx.n)}`)
            },
            teardown: (ctx: { n: number }) => {
              events.push(`teardown ${String(ctx.n)}`)
            },
          },
        ],
      }),
      {
        only: ["sum"],
        sampling: SAMPLING(10, { minIterations: 3, maxIterations: 3 }),
        root: process.cwd(),
      },
    )
    expect(events).toEqual(["setup 20", "run 20", "run 20", "run 20", "teardown 20"])
  })

  it("builds fresh state for every sample when the function asks for it, and not otherwise", async () => {
    const events: string[] = []
    const functions = (fresh: unknown) => [
      {
        id: "sum",
        fresh,
        setup: () => events.push("setup"),
        run: () => events.push("run"),
        teardown: () => events.push("teardown"),
      },
    ]
    const options = {
      only: ["sum"],
      sampling: SAMPLING(10, { minIterations: 2, maxIterations: 2 }),
      root: process.cwd(),
    }
    await runSuite(suiteOf({ tiers: [20], functions: functions(true) }), options)
    expect(events).toEqual(["setup", "run", "teardown", "setup", "run", "teardown"])
    for (const notFresh of [false, undefined, "yes", 1]) {
      events.length = 0
      await runSuite(suiteOf({ tiers: [20], functions: functions(notFresh) }), options)
      expect(events, String(notFresh)).toEqual(["setup", "run", "run", "teardown"])
    }
  })

  it("tolerates a fresh function with no setup or teardown", async () => {
    const results = await runSuite(
      suiteOf({ tiers: [20], functions: [{ id: "sum", fresh: true, run: () => 1 }] }),
      {
        only: ["sum"],
        sampling: SAMPLING(10, { minIterations: 2, maxIterations: 2 }),
        root: process.cwd(),
      },
    )
    expect(results.results["fn:sum"].tiers.n20.status).toBe("completed")
    const plain = await runSuite(
      suiteOf({ tiers: [20], functions: [{ id: "sum", run: () => 1 }] }),
      {
        only: ["sum"],
        sampling: SAMPLING(10),
        root: process.cwd(),
      },
    )
    expect(plain.results["fn:sum"].tiers.n20.status).toBe("completed")
  })

  it("hands a variant's options to setup, and nothing for a function with none", async () => {
    const seen: unknown[][] = []
    await runSuite(
      suiteOf({
        tiers: [20],
        functions: [
          {
            id: "sum",
            variants: [{ name: "cold", options: { warm: false } }, { name: "warm" }],
            setup: (...args: unknown[]) => seen.push(args),
            run: () => 1,
          },
          { id: "other", setup: (...args: unknown[]) => seen.push(args), run: () => 1 },
        ],
      }),
      { only: ["sum", "other"], sampling: SAMPLING(10), root: process.cwd() },
    )
    expect(seen).toEqual([
      [20, { warm: false }],
      [20, undefined],
      [20, undefined],
    ])
  })

  it("lets a function override the sampling for itself, keeping the rest", async () => {
    const results = await runSuite(
      suiteOf({
        tiers: [20],
        functions: [{ id: "sum", run: () => 1, sampling: { maxIterations: 1, minIterations: 1 } }],
      }),
      {
        only: ["sum"],
        sampling: SAMPLING(10, { minIterations: 3, maxIterations: 3 }),
        root: process.cwd(),
      },
    )
    expect(results.results["fn:sum"].tiers.n20.configuration).toMatchObject({
      minIterations: 1,
      maxIterations: 1,
      warmupIterations: 0,
    })
  })
})

describe("runSuite() a tier that fails", () => {
  const failing = async (thrown: () => never, extra: Loose = {}) => {
    const events: string[] = []
    const results = await runSuite(
      suiteOf({
        tiers: [20],
        functions: [{ id: "sum", run: thrown, teardown: () => events.push("teardown"), ...extra }],
      }),
      { only: ["sum"], sampling: SAMPLING(10), root: process.cwd() },
    )
    return { entry: results.results["fn:sum"].tiers.n20 as Loose, events }
  }

  it("records the error's name and message, keeps the other fields, and still tears down", async () => {
    class Custom extends Error {
      override name = "CustomError"
    }
    const { entry, events } = await failing(() => {
      throw new Custom("it broke")
    })
    expect(entry).toEqual({
      id: "fn:sum@n20",
      status: "failed",
      inputs: { item: 20 },
      error: { name: "CustomError", message: "it broke" },
    })
    expect(events).toEqual(["teardown"])
  })

  it("copes with anything being thrown", async () => {
    const thrown = async (value: unknown) =>
      (
        await failing(() => {
          throw value
        })
      ).entry["error"]
    expect(await thrown("boom")).toEqual({ name: "Error", message: "boom" })
    expect(await thrown(null)).toEqual({ name: "Error", message: "null" })
    expect(await thrown(undefined)).toEqual({ name: "Error", message: "undefined" })
    expect(await thrown({ message: "m" })).toEqual({ name: "Error", message: "m" })
    expect(await thrown({ name: "Named", message: "n" })).toEqual({ name: "Named", message: "n" })
    expect(await thrown({})).toEqual({ name: "Error", message: "[object Object]" })
  })

  it("records a failing setup the same way, and carries on with the other tiers", async () => {
    const results = await runSuite(
      suiteOf({
        tiers: [20, 40],
        functions: [
          {
            id: "sum",
            setup: (n: number) => {
              if (n === 20) throw new Error("no setup")
              return n
            },
            run: () => 1,
          },
        ],
      }),
      { only: ["sum"], sampling: SAMPLING(10), root: process.cwd() },
    )
    expect(results.results["fn:sum"].tiers.n20).toMatchObject({
      status: "failed",
      error: { message: "no setup" },
    })
    expect(results.results["fn:sum"].tiers.n40.status).toBe("completed")
  })
})

describe("runSuite() which groups it measures", () => {
  const keys = async (options: Loose, suite: Loose = suiteOf()) =>
    Object.keys(
      (await runSuite(suite, { sampling: SAMPLING(10), root: process.cwd(), ...options })).results,
    )

  it("measures the end-to-end pair and every function by default, then derives the overhead", async () => {
    expect(await keys({})).toEqual([
      "end-to-end:baseline",
      "end-to-end:with-package",
      "fn:sum",
      "end-to-end:overhead",
    ])
    expect(await keys({ only: [] })).toEqual([
      "end-to-end:baseline",
      "end-to-end:with-package",
      "fn:sum",
      "end-to-end:overhead",
    ])
  })

  it("restricts to the ids it is given", async () => {
    expect(await keys({ only: ["sum"] })).toEqual(["fn:sum"])
    expect(await keys({ only: ["end-to-end"] })).toEqual([
      "end-to-end:baseline",
      "end-to-end:with-package",
      "end-to-end:overhead",
    ])
    const two = suiteOf({
      functions: [
        { id: "a", run: () => 1 },
        { id: "b", run: () => 1 },
        { id: "c", run: () => 1 },
      ],
    })
    expect(await keys({ only: ["a", "c"] }, two)).toEqual(["fn:a", "fn:c"])
  })

  it("names a group per variant, and one plain group when the variants list is empty", async () => {
    const variants = suiteOf({
      functions: [
        { id: "a", variants: [{ name: "x" }, { name: "y" }], run: () => 1 },
        { id: "b", variants: [], run: () => 1 },
      ],
    })
    expect(await keys({ only: ["a", "b"] }, variants)).toEqual(["fn:a@x", "fn:a@y", "fn:b"])
  })

  it("gives a function its own tier ladder when it declares one", async () => {
    const own = suiteOf({ functions: [{ id: "a", tiers: [5, 6, 7], run: () => 1 }] })
    const results = await runSuite(own, {
      only: ["a"],
      sampling: SAMPLING(10),
      root: process.cwd(),
    })
    expect(Object.keys(results.results["fn:a"].tiers)).toEqual(["n5", "n6", "n7"])
  })

  it("reports progress as it goes", async () => {
    const messages: string[] = []
    await runSuite(suiteOf({ tiers: [20, 40] }), {
      sampling: SAMPLING(10),
      root: process.cwd(),
      onProgress: (m: string) => messages.push(m),
    })
    expect(messages).toEqual([
      "end-to-end:baseline n=20",
      "end-to-end:baseline n=40",
      "end-to-end:with-package n=20",
      "end-to-end:with-package n=40",
      "fn:sum n=20",
      "fn:sum n=40",
    ])
  })

  it("measures the quick ladder when asked, with quick sampling unless told otherwise", async () => {
    const quickSuite = suiteOf({
      functions: [
        {
          id: "sum",
          run: () => 1,
          sampling: { warmupIterations: 0, minSampleMs: 0, instruments: instruments(10) },
        },
      ],
    })
    const results = await runSuite(quickSuite, { quick: true, only: ["sum"], root: process.cwd() })
    expect(results.metadata.tiers).toEqual(QUICK_TIERS)
    expect(Object.keys(results.results["fn:sum"].tiers)).toEqual(
      QUICK_TIERS.map((n: number) => `n${String(n)}`),
    )
    expect(results.results["fn:sum"].tiers.n20.configuration).toMatchObject({
      targetDurationMs: 80,
      maxIterations: 20,
    })
    const full = await runSuite(quickSuite, { only: ["sum"], root: process.cwd() })
    expect(full.metadata.tiers).toEqual([20, 40])
    expect(full.results["fn:sum"].tiers.n20.configuration).toMatchObject({
      targetDurationMs: 300,
      maxIterations: 60,
    })
  })
})

describe("runSuite() the end-to-end overhead", () => {
  const run = (baselineStep: number, packageStep: number) =>
    runSuite(
      suiteOf({
        tiers: [20, 40],
        endToEnd: {
          purpose: "x",
          baseline: { run: () => 1, sampling: { ...SAMPLING(baselineStep) } },
          withPackage: { run: () => 2, sampling: { ...SAMPLING(packageStep) } },
        },
      }),
      { only: ["end-to-end"], sampling: {}, root: process.cwd() },
    )

  it("is a derived group of what the package adds, at every size where it adds something", async () => {
    const results = await run(10, 25)
    expect(results.results["end-to-end:overhead"]).toEqual({
      area: "end-to-end",
      derived: true,
      tiers: {
        n20: {
          id: "end-to-end:overhead@n20",
          status: "completed",
          derived: true,
          inputs: { item: 20 },
          durationMs: { medianMs: 15 },
        },
        n40: {
          id: "end-to-end:overhead@n40",
          status: "completed",
          derived: true,
          inputs: { item: 40 },
          durationMs: { medianMs: 15 },
        },
      },
    })
    expect(results.analysis.endToEnd[0]).toMatchObject({
      n: 20,
      baselineMs: 10,
      withPackageMs: 25,
      overheadMs: 15,
      overheadPercent: 150,
    })
  })

  it("leaves out sizes where the package adds nothing, but still lists the group", async () => {
    const results = await run(25, 10)
    expect(results.results["end-to-end:overhead"]).toEqual({
      area: "end-to-end",
      derived: true,
      tiers: {},
    })
    const equal = await run(10, 10)
    expect(equal.results["end-to-end:overhead"].tiers).toEqual({})
  })

  it("is not derived when there is no end-to-end measurement at all", async () => {
    const results = await runSuite(suiteOf(), {
      only: ["sum"],
      sampling: SAMPLING(10),
      root: process.cwd(),
    })
    expect(results.results["end-to-end:overhead"]).toBeUndefined()
    expect(results.analysis.endToEnd).toEqual([])
  })
})

describe("runSuite() the metadata", () => {
  it("records the schema, package, workload, tiers and cost rates", async () => {
    const results = await runSuite(suiteOf(), {
      sampling: SAMPLING(10),
      root: process.cwd(),
      rates: { vCpuHourUsd: 1 },
    })
    expect(results.metadata).toMatchObject({
      schemaVersion: 4,
      package: { name: "demo", version: "1.2.3" },
      workload: { unit: "item", description: "One item.", typicalN: 20 },
      tiers: [20, 40],
      costRates: { ...DEFAULT_RATES, vCpuHourUsd: 1 },
      generatedBy: generatedBy(process.env),
      versions: { demo: "1.2.3" },
    })
    expect(results.metadata.environment.nodeVersion).toBe(process.version)
    expect(Object.keys(results.metadata.git).sort()).toEqual(["gitBranch", "gitCommit", "gitDirty"])
    const unrated = await runSuite(suiteOf(), { sampling: SAMPLING(10), root: process.cwd() })
    expect(unrated.metadata.costRates).toEqual(DEFAULT_RATES)
  })

  it("has no versions entry for a package without a version", async () => {
    const results = await runSuite(suiteOf({ package: { name: "demo" } }), {
      sampling: SAMPLING(10),
      root: process.cwd(),
    })
    expect(results.metadata.versions).toEqual({})
    const empty = await runSuite(suiteOf({ package: { name: "demo", version: "" } }), {
      sampling: SAMPLING(10),
      root: process.cwd(),
    })
    expect(empty.metadata.versions).toEqual({})
  })

  it("times the suite from the clock it is given", async () => {
    const times = [new Date("2026-01-01T00:00:00.000Z"), new Date("2026-01-01T00:00:01.234Z")]
    let call = 0
    const results = await runSuite(suiteOf(), {
      sampling: SAMPLING(10),
      root: process.cwd(),
      now: () => times[call++] ?? times[1]!,
    })
    expect(results.metadata.timing).toEqual({
      startedAtUtc: "2026-01-01T00:00:00.000Z",
      finishedAtUtc: "2026-01-01T00:00:01.234Z",
      totalSuiteDurationMs: 1234,
    })
    const real = await runSuite(suiteOf(), { sampling: SAMPLING(10), root: process.cwd() })
    expect(real.metadata.timing.startedAtUtc).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/)
    expect(real.metadata.timing.totalSuiteDurationMs).toBeGreaterThanOrEqual(0)
  })

  it("measures the bundle files it is told to, relative to the root, and none by default", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "ipc-run-bundle-"))
    roots.push(root)
    mkdirSync(path.join(root, "dist"))
    writeFileSync(path.join(root, "dist/index.js"), "export const x = 1\n")
    const none = await runSuite(suiteOf(), { sampling: SAMPLING(10), root })
    expect(none.metadata.bundleSizes).toEqual({})
    const fromSuite = await runSuite(
      suiteOf({ package: { name: "demo", bundleFiles: ["dist/index.js"] } }),
      { sampling: SAMPLING(10), root },
    )
    expect(Object.keys(fromSuite.metadata.bundleSizes)).toEqual(["dist/index.js"])
    expect(fromSuite.metadata.bundleSizes["dist/index.js"].bytes).toBe(19)
    const fromOptions = await runSuite(
      suiteOf({ package: { name: "demo", bundleFiles: ["dist/index.js"] } }),
      {
        sampling: SAMPLING(10),
        root,
        bundleFiles: ["dist/other.js"],
      },
    )
    expect(fromOptions.metadata.bundleSizes).toEqual({
      "dist/other.js": { bytes: null, gzipBytes: null },
    })
    const viaCwd = await runSuite(suiteOf(), {
      sampling: SAMPLING(10),
      bundleFiles: ["package.json"],
    })
    expect(viaCwd.metadata.bundleSizes["package.json"].bytes).toBeGreaterThan(0)
  })
})

// ---- analyze() ----

const entry = (n: number, medianMs: number, extra: Loose = {}) => ({
  id: `g@n${String(n)}`,
  status: "completed",
  inputs: { items: n },
  durationMs: { medianMs },
  cpuMs: { medianMs: 0 },
  heapDeltaBytes: 0,
  ...extra,
})
const ladder = (f: (n: number) => number, ns = [10, 20, 40, 80, 160]) =>
  Object.fromEntries(ns.map((n) => [`n${String(n)}`, entry(n, f(n))]))
const fnGroup = (tiers: Loose) => ({ area: "function", tiers })
const e2eGroup = (tiers: Loose) => ({ area: "end-to-end", tiers })

describe("analyze() complexity", () => {
  const suite = {
    workload: { typicalN: 40 },
    functions: [
      {
        id: "sum",
        expectedComplexity: "linear",
        complexityReason: "scans once",
        variants: [
          { name: "fast", expectedComplexity: "constant", complexityReason: "skips" },
          { name: "plain" },
        ],
      },
      { id: "sum-two", expectedComplexity: "quadratic", complexityReason: "nested" },
    ],
  }
  const analyzed = (results: Loose) =>
    analyze({ suite, results, tiers: [10, 20, 40, 80, 160] }).complexity

  it("classifies every measured group and sets the documented expectation against it", () => {
    const complexity = analyzed({
      "fn:sum": fnGroup(ladder((n) => n * 0.1)),
      "fn:sum@fast": fnGroup(ladder((n) => n * 0.1)),
      "fn:sum@plain": fnGroup(ladder((n) => n * 0.1)),
      "fn:sum-two": fnGroup(ladder(() => 5)),
      "end-to-end:baseline": e2eGroup(ladder((n) => n * 0.1)),
    })
    expect(Object.keys(complexity)).toEqual([
      "fn:sum",
      "fn:sum@fast",
      "fn:sum@plain",
      "fn:sum-two",
      "end-to-end:baseline",
    ])
    expect(complexity["fn:sum"]).toMatchObject({
      class: "linear",
      rSquared: 1,
      notation: "O(n)",
      points: 5,
      expected: "linear",
      expectedNotation: "O(n)",
      agreement: "matches",
    })
    expect(complexity["fn:sum"]?.exponent).toBeCloseTo(1, 9)
    expect(complexity["fn:sum@fast"]).toMatchObject({
      expected: "constant",
      expectedNotation: "O(1)",
      agreement: "differs",
    })
    expect(complexity["fn:sum@plain"]).toMatchObject({ expected: "linear", agreement: "matches" })
    expect(complexity["fn:sum-two"]).toMatchObject({
      class: "constant",
      expected: "quadratic",
      expectedNotation: "O(n²)",
      agreement: "differs",
    })
    expect(Object.keys(complexity["end-to-end:baseline"] ?? {}).sort()).toEqual([
      "class",
      "exponent",
      "notation",
      "points",
      "rSquared",
    ])
  })

  it("skips derived groups, and says why a group could not be classified", () => {
    const complexity = analyzed({
      "end-to-end:overhead": { area: "end-to-end", derived: true, tiers: ladder((n) => n) },
      "fn:sum": fnGroup({ n10: entry(10, 1) }),
    })
    expect(Object.keys(complexity)).toEqual(["fn:sum"])
    expect(complexity["fn:sum"]).toEqual({
      class: null,
      exponent: null,
      rSquared: null,
      reason: "insufficient-data",
      notation: null,
      points: 1,
      expected: "linear",
      expectedNotation: "O(n)",
      agreement: "unknown",
    })
  })

  it("ignores failed tiers when classifying", () => {
    const tiers = ladder((n) => n * 0.1)
    tiers["n10"] = {
      id: "x",
      status: "failed",
      inputs: { items: 10 },
      error: { name: "E", message: "m" },
    } as never
    expect(analyzed({ "fn:sum": fnGroup(tiers) })["fn:sum"]).toMatchObject({
      class: "linear",
      points: 4,
    })
  })

  it("does not mistake one function id for another that starts with it", () => {
    const complexity = analyzed({
      "fn:sum-two": fnGroup(ladder(() => 5)),
      "fn:summary": fnGroup(ladder(() => 5)),
    })
    expect(complexity["fn:sum-two"]).toMatchObject({ expected: "quadratic" })
    expect(complexity["fn:summary"]).not.toHaveProperty("expected")
  })
})

describe("analyze() end to end", () => {
  const rates = { vCpuHourUsd: 0.05 }
  const side = (rows: Record<number, [number, number, number]>, status = "completed") =>
    e2eGroup(
      Object.fromEntries(
        Object.entries(rows).map(([n, [ms, cpu, heap]]) => [
          `n${n}`,
          { ...entry(Number(n), ms, { cpuMs: { medianMs: cpu }, heapDeltaBytes: heap }), status },
        ]),
      ),
    )
  const suite = { workload: { typicalN: 20 }, functions: [] }

  it("takes the overhead at each size both sides completed, never below zero", () => {
    const { endToEnd } = analyze({
      suite,
      tiers: [20, 40, 80],
      rates,
      results: {
        "end-to-end:baseline": side({ 20: [10, 2, 100], 40: [30, 5, 50], 80: [10, 1, 1] }),
        "end-to-end:with-package": side({ 20: [25, 5, 400], 40: [20, 3, 10] }),
      },
    })
    expect(endToEnd.map((row: Loose) => row["n"])).toEqual([20, 40])
    expect(endToEnd[0]).toEqual({
      n: 20,
      baselineMs: 10,
      withPackageMs: 25,
      overheadMs: 15,
      overheadPercent: 150,
      overheadCpuMs: 3,
      overheadHeapBytes: 300,
      cost: estimateCost({ wallMs: 15, cpuMs: 3, heapBytes: 300 }, rates),
    })
    expect(endToEnd[1]).toMatchObject({
      overheadMs: 0,
      overheadCpuMs: 0,
      overheadHeapBytes: 0,
      overheadPercent: 0,
    })
  })

  it("has no percentage when the baseline took no time, and skips a failed side", () => {
    const { endToEnd } = analyze({
      suite,
      tiers: [20, 40],
      results: {
        "end-to-end:baseline": side({ 20: [0, 0, 0], 40: [5, 0, 0] }),
        "end-to-end:with-package": {
          area: "end-to-end",
          tiers: {
            n20: entry(20, 4, { cpuMs: { medianMs: 0 } }),
            n40: { id: "x", status: "failed", inputs: {}, error: { name: "E", message: "m" } },
          },
        },
      },
    })
    expect(endToEnd).toHaveLength(1)
    expect(endToEnd[0]).toMatchObject({ n: 20, overheadMs: 4, overheadPercent: null })
  })

  it("is empty without either side", () => {
    expect(
      analyze({ suite, tiers: [20], results: { "end-to-end:baseline": side({ 20: [1, 0, 0] }) } })
        .endToEnd,
    ).toEqual([])
    expect(
      analyze({
        suite,
        tiers: [20],
        results: { "end-to-end:with-package": side({ 20: [1, 0, 0] }) },
      }).endToEnd,
    ).toEqual([])
    expect(analyze({ suite, tiers: [20], results: {} }).endToEnd).toEqual([])
  })
})

describe("analyze() contribution", () => {
  const fns = [
    { id: "a", inEndToEnd: { callsPerOperation: 3, description: "three calls" } },
    {
      id: "b",
      variants: [{ name: "v1" }, { name: "v2" }],
      inEndToEnd: {
        callsPerOperation: (n: number) => n / 10,
        description: "per ten",
        includes: ["a", "ghost"],
      },
    },
    {
      id: "c",
      variants: [{ name: "v1" }, { name: "v2" }],
      inEndToEnd: { variant: "v2", callsPerOperation: 1, description: "second" },
    },
    { id: "d", inEndToEnd: undefined },
    { id: "e", inEndToEnd: { callsPerOperation: 1, description: "missing group" } },
    { id: "f", variants: [], inEndToEnd: { callsPerOperation: 1, description: "no variants" } },
  ]
  const suite = { workload: { typicalN: 20 }, functions: fns }
  const e2e = (rows: Record<number, number>) =>
    e2eGroup(
      Object.fromEntries(Object.entries(rows).map(([n, ms]) => [`n${n}`, entry(Number(n), ms)])),
    )
  const results = {
    "end-to-end:baseline": e2e({ 20: 10, 40: 10 }),
    "end-to-end:with-package": e2e({ 20: 100, 40: 0 }),
    "fn:a": fnGroup(ladder(() => 2, [20, 40])),
    "fn:b@v1": fnGroup(ladder(() => 5, [20, 40])),
    "fn:c@v2": fnGroup(ladder(() => 4, [20])),
    "fn:f": fnGroup(ladder(() => 1, [20])),
  }
  const contributionOf = () => analyze({ suite, results, tiers: [20, 40] }).contribution

  it("lists each function that is part of the operation, with its group and description", () => {
    const contribution = contributionOf()
    expect(contribution.map((c: Loose) => [c["id"], c["group"], c["description"]])).toEqual([
      ["a", "fn:a", "three calls"],
      ["b", "fn:b@v1", "per ten"],
      ["c", "fn:c@v2", "second"],
      ["e", "fn:e", "missing group"],
      ["f", "fn:f", "no variants"],
    ])
    expect(contribution[3]?.rows).toEqual([])
  })

  it("estimates time as the function's median times its calls per operation", () => {
    const contribution = contributionOf()
    expect(contribution[0]?.rows).toEqual([
      { n: 20, calls: 3, estimatedMs: 6, exclusiveMs: 6, shareOfTotal: 0.06 },
      { n: 40, calls: 3, estimatedMs: 6, exclusiveMs: 6, shareOfTotal: null },
    ])
  })

  it("subtracts the time of the functions it includes, never below zero, ignoring unknown ones", () => {
    const contribution = contributionOf()
    expect(contribution[1]?.rows).toEqual([
      { n: 20, calls: 2, estimatedMs: 10, exclusiveMs: 4, shareOfTotal: 0.04 },
      { n: 40, calls: 4, estimatedMs: 20, exclusiveMs: 14, shareOfTotal: null },
    ])
    const small = analyze({
      suite,
      tiers: [20],
      results: {
        ...results,
        "fn:a": fnGroup(ladder(() => 100, [20])),
        "fn:b@v1": fnGroup(ladder(() => 1, [20])),
      },
    }).contribution[1]?.rows[0]
    expect(small).toMatchObject({ estimatedMs: 2, exclusiveMs: 0 })
  })

  it("follows the variant named in inEndToEnd, only at sizes it was measured", () => {
    const contribution = contributionOf()
    expect(contribution[2]?.rows).toEqual([
      { n: 20, calls: 1, estimatedMs: 4, exclusiveMs: 4, shareOfTotal: 0.04 },
    ])
  })

  it("counts an included function that was not measured at that size as nothing", () => {
    const partial = analyze({
      suite,
      tiers: [20, 40],
      results: { ...results, "fn:a": fnGroup(ladder(() => 2, [20])) },
    }).contribution[1]?.rows
    expect(partial?.[1]).toMatchObject({ n: 40, estimatedMs: 20, exclusiveMs: 20 })
  })
})

describe("analyze() cost", () => {
  const e2e = (rows: Record<number, number>) =>
    e2eGroup(
      Object.fromEntries(Object.entries(rows).map(([n, ms]) => [`n${n}`, entry(Number(n), ms)])),
    )
  const results = {
    "end-to-end:baseline": e2e({ 20: 1, 40: 1, 80: 1 }),
    "end-to-end:with-package": e2e({ 20: 2, 40: 3, 80: 5 }),
  }
  const costOf = (typicalN: number, tiers = [20, 40, 80], from: Loose = results) =>
    analyze({ suite: { workload: { typicalN }, functions: [] }, results: from, tiers }).cost

  it("is at the size nearest the typical one, with the largest size measured", () => {
    const near = costOf(45)
    expect(near.typicalN).toBe(40)
    expect(near.typical).toMatchObject({ n: 40, overheadMs: 2 })
    expect(near.largest).toMatchObject({ n: 80 })
    expect(costOf(1000).typicalN).toBe(80)
    expect(costOf(1).typicalN).toBe(20)
    expect(costOf(60).typicalN).toBe(40)
  })

  it("falls back to the nearest tier, then to the typical size itself, when nothing was measured", () => {
    const none = costOf(45, [20, 40, 80], {})
    expect(none).toEqual({ typicalN: 40, typical: undefined, largest: undefined })
    expect(costOf(45, [], {})).toEqual({ typicalN: 45, typical: undefined, largest: undefined })
    expect(costOf(70, [20, 80, 40], {}).typicalN).toBe(80)
  })
})
