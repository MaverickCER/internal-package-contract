import { describe, expect, it } from "vitest"
import {
  COMPLEXITY_NOTATION,
  DEFAULT_RATES,
  QUICK_TIERS,
  STANDARD_TIERS,
  SuiteDefinitionError,
  agreement,
  analyze,
  computeDurationStats,
  defineSuite,
  estimateCost,
  expectationOf,
  formatBytes,
  formatMs,
  formatUsd,
  percentile,
  renderReport,
  runSuite,
  sample,
  tierName,
  timed,
  validateResults,
  validateTiers,
} from "../scripts/benchmark/kit/index.mjs"
import type { Suite } from "../scripts/benchmark/kit/index.mjs"

const LONG = "A sufficiently long and honest explanation."

function validSuite(overrides: Partial<Suite> = {}): Suite {
  return {
    package: { name: "demo", version: "1.2.3" },
    workload: { unit: "item", description: "One item processed per unit of n.", typicalN: 640 },
    endToEnd: {
      purpose: LONG,
      baseline: { description: LONG, setup: (n) => n, run: (n) => n },
      withPackage: {
        description: LONG,
        setup: (n) => n,
        run: (n) => {
          let total = 0
          for (let i = 0; i < (n as number); i += 1) total += i
          return total
        },
      },
      variables: [{ name: "items", how: "swept", description: "The tier axis." }],
    },
    functions: [
      {
        id: "sum",
        name: "sum",
        why: LONG,
        poorPerformanceMeans: LONG,
        expectedComplexity: "linear",
        complexityReason: LONG,
        variables: [{ name: "items", how: "swept", description: "The tier axis." }],
        inEndToEnd: { callsPerOperation: 1, description: "Called once per operation." },
        setup: (n) => n,
        run: (n) => {
          let total = 0
          for (let i = 0; i < (n as number); i += 1) total += i
          return total
        },
      },
    ],
    ...overrides,
  }
}

describe("tiers", () => {
  it("is the ten-point doubling ladder, with a five-point quick ladder", () => {
    expect(STANDARD_TIERS).toEqual([20, 40, 80, 160, 320, 640, 1280, 2560, 5120, 10240])
    expect(QUICK_TIERS).toEqual([20, 40, 80, 160, 320])
    expect(tierName(640)).toBe("n640")
  })
  it("validates a tier list", () => {
    expect(validateTiers(STANDARD_TIERS)).toEqual([])
    expect(validateTiers([1, 2, 3])).toEqual([
      "tiers must list at least 4 sizes, or the growth rate (big-O) cannot be estimated",
    ])
    expect(validateTiers("x" as never)).toHaveLength(1)
    expect(validateTiers([1, 2, 3, 4.5])).toEqual(["tiers must all be positive integers"])
    expect(validateTiers([1, 2, 3, 0])).toContain("tiers must all be positive integers")
    expect(validateTiers([1, 2, 2, 3])).toEqual(["tiers must be strictly ascending"])
    expect(validateTiers([1, 3, 2, 4])).toEqual(["tiers must be strictly ascending"])
  })
})

describe("measure", () => {
  it("computes percentiles, tolerating an empty list", () => {
    expect(percentile([], 0.5)).toBe(0)
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(3)
    expect(percentile([1, 2, 3, 4], 0.95)).toBe(4)
    expect(percentile([1, 2, 3, 4], 0)).toBe(1)
  })
  it("computes duration statistics", () => {
    const stats = computeDurationStats([4, 1, 3, 2], 2)
    expect(stats).toMatchObject({
      minMs: 1,
      medianMs: 3,
      maxMs: 4,
      iterations: 4,
      warmupIterations: 2,
    })
    expect(stats.stdDevMs).toBeCloseTo(1.118, 3)
    expect(computeDurationStats([], 0)).toEqual({
      minMs: 0,
      medianMs: 0,
      p95Ms: 0,
      maxMs: 0,
      stdDevMs: 0,
      iterations: 0,
      warmupIterations: 0,
    })
  })
  it("honours min/max iterations and warmup, and reports the configuration", async () => {
    let calls = 0
    const result = await sample(
      () => {
        calls += 1
      },
      {
        warmupIterations: 1,
        minIterations: 3,
        maxIterations: 3,
        targetDurationMs: 0,
        minSampleMs: 0,
      },
    )
    expect(result.wallMs).toHaveLength(3)
    expect(result.cpuMs).toHaveLength(3)
    expect(result.heapDeltaBytes).toHaveLength(3)
    expect(calls).toBe(4)
    expect(result.configuration).toMatchObject({
      warmupIterations: 1,
      minIterations: 3,
      maxIterations: 3,
      batchSize: 1,
    })
  })
  it("records a duration reported with timed(), but never reads a plain returned number as a time", async () => {
    const reported = await sample(() => timed(7), {
      warmupIterations: 0,
      minIterations: 2,
      maxIterations: 2,
      targetDurationMs: 0,
      minSampleMs: 0,
    })
    expect(reported.wallMs).toEqual([7, 7])
    const plain = await sample(() => 7, {
      warmupIterations: 0,
      minIterations: 1,
      maxIterations: 1,
      targetDurationMs: 0,
      minSampleMs: 0,
    })
    expect(plain.wallMs[0]).toBeLessThan(5)
    const nonFinite = await sample(() => timed(Number.NaN), {
      warmupIterations: 0,
      minIterations: 1,
      maxIterations: 1,
      targetDurationMs: 0,
      minSampleMs: 0,
    })
    expect(nonFinite.wallMs[0]).toBeLessThan(5)
    const otherObject = await sample(() => ({ a: 1 }), {
      warmupIterations: 0,
      minIterations: 1,
      maxIterations: 1,
      targetDurationMs: 0,
      minSampleMs: 0,
    })
    expect(otherObject.wallMs[0]).toBeLessThan(5)
    const nothing = await sample(() => null, {
      warmupIterations: 0,
      minIterations: 1,
      maxIterations: 1,
      targetDurationMs: 0,
      minSampleMs: 0,
    })
    expect(nothing.wallMs[0]).toBeLessThan(5)
  })
  it("batches operations faster than minSampleMs and divides the result", async () => {
    let calls = 0
    const result = await sample(
      () => {
        calls += 1
      },
      {
        warmupIterations: 2,
        minIterations: 3,
        maxIterations: 3,
        targetDurationMs: 0,
        minSampleMs: 5,
      },
    )
    expect(result.configuration["batchSize"]).toBeGreaterThan(1)
    expect(calls).toBeGreaterThan(10)
  })
  it("never batches when state must be prepared fresh, and runs prepare/release around every sample", async () => {
    const events: string[] = []
    const result = await sample(
      () => {
        events.push("run")
      },
      {
        warmupIterations: 0,
        minIterations: 2,
        maxIterations: 2,
        targetDurationMs: 0,
        minSampleMs: 50,
        prepare: () => {
          events.push("prepare")
        },
        release: () => {
          events.push("release")
        },
      },
    )
    expect(result.configuration["batchSize"]).toBe(1)
    expect(events).toEqual(["prepare", "run", "release", "prepare", "run", "release"])
  })
  it("keeps sampling until the target duration when below maxIterations", async () => {
    const result = await sample(() => new Promise((resolve) => setTimeout(resolve, 2)), {
      warmupIterations: 0,
      minIterations: 1,
      maxIterations: 1000,
      targetDurationMs: 30,
      minSampleMs: 0,
    })
    expect(result.wallMs.length).toBeGreaterThan(2)
    expect(result.wallMs.length).toBeLessThan(1000)
  })
})

describe("cost model", () => {
  it("prices CPU-priced and duration-and-memory-priced compute, plus the throughput ceiling", () => {
    const cost = estimateCost({ wallMs: 10, cpuMs: 5, heapBytes: 0 })
    expect(cost.lowUsdPerMillion).toBeCloseTo((0.005 / 3600) * DEFAULT_RATES.vCpuHourUsd * 1e6, 12)
    expect(cost.highUsdPerMillion).toBeCloseTo(
      0.01 * (128 / 1024) * DEFAULT_RATES.gbSecondUsd * 1e6,
      12,
    )
    expect(cost.opsPerSecondPerCore).toBe(100)
  })
  it("reserves the larger of the platform minimum and the heap, and honours overridden rates", () => {
    const big = estimateCost(
      { wallMs: 1000, cpuMs: 0, heapBytes: 1024 * 1024 * 1024 },
      { gbSecondUsd: 1 },
    )
    expect(big.highUsdPerMillion).toBeCloseTo(1 * 1 * 1 * 1e6, 3)
    const small = estimateCost(
      { wallMs: 1000, cpuMs: 0, heapBytes: 1024 },
      { gbSecondUsd: 1, minMemoryMb: 1024 },
    )
    expect(small.highUsdPerMillion).toBeCloseTo(1e6, 3)
    expect(estimateCost({ wallMs: 0, cpuMs: 0 }).opsPerSecondPerCore).toBe(Infinity)
  })
  it("formats dollars compactly", () => {
    expect(formatUsd(Number.NaN)).toBe("n/a")
    expect(formatUsd(0)).toBe("$0")
    expect(formatUsd(12.345)).toBe("$12.35")
    expect(formatUsd(1)).toBe("$1.00")
    expect(formatUsd(0.0123)).toBe("$0.012")
    expect(formatUsd(0.01)).toBe("$0.010")
    expect(formatUsd(0.0000045)).toBe("$0.0000045")
    expect(formatUsd(0.0000002)).toBe("$0.0000002")
  })
})

describe("defineSuite()", () => {
  it("accepts a fully documented suite and applies defaults", () => {
    const suite = defineSuite(validSuite())
    expect(suite.tiers).toEqual(STANDARD_TIERS)
    expect(Object.isFrozen(suite)).toBe(true)
  })
  it("defaults typicalN to 640 and rejects one that is not a tier", () => {
    const noTypical = validSuite()
    delete (noTypical.workload as { typicalN?: number }).typicalN
    expect((defineSuite(noTypical).workload as { typicalN: number }).typicalN).toBe(640)
    expect(() =>
      defineSuite(validSuite({ workload: { unit: "item", description: LONG, typicalN: 7 } })),
    ).toThrow("workload.typicalN (7) must be one of the tiers.")
  })
  it("rejects undocumented or placeholder documentation, listing every problem at once", () => {
    const bad = validSuite()
    bad.functions[0] = {
      ...bad.functions[0]!,
      why: "todo",
      poorPerformanceMeans: "",
      complexityReason: "x",
      expectedComplexity: "fast" as never,
      variables: [],
    }
    try {
      defineSuite(bad)
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(SuiteDefinitionError)
      const { problems } = error as SuiteDefinitionError
      expect(problems.join("\n")).toContain(
        "functions[0] (sum).why (why this is benchmarked) must be a real explanation",
      )
      expect(problems.join("\n")).toContain("poorPerformanceMeans")
      expect(problems.join("\n")).toContain(
        "expectedComplexity must be one of: constant, logarithmic",
      )
      expect(problems.join("\n")).toContain("complexityReason")
      expect(problems.join("\n")).toContain("variables must list every variable")
      expect(problems.length).toBeGreaterThanOrEqual(5)
    }
  })
  it("validates shape: package, workload, tiers, end-to-end, functions", () => {
    const messages = (suite: unknown): string => {
      try {
        defineSuite(suite as Suite)
        return ""
      } catch (error) {
        return (error as SuiteDefinitionError).problems.join("\n")
      }
    }
    expect(messages({})).toContain("package.name is required.")
    expect(messages({})).toContain("workload.unit is required")
    expect(messages({})).toContain("endToEnd.purpose")
    expect(messages({})).toContain("functions must list at least one benchmarked function.")
    expect(messages(validSuite({ tiers: [1, 2] }))).toContain(
      "tiers: tiers must list at least 4 sizes",
    )
    const noRun = validSuite()
    ;(noRun.endToEnd.baseline as { run?: unknown }).run = undefined
    expect(messages(noRun)).toContain(
      "endToEnd.baseline.run must be a function (or give call and input).",
    )
    const dup = validSuite()
    dup.functions.push({ ...dup.functions[0]! })
    expect(messages(dup)).toContain("sum).id is duplicated.")
    const badId = validSuite()
    badId.functions[0] = { ...badId.functions[0]!, id: "Not Kebab" }
    expect(messages(badId)).toContain(".id must be kebab-case")
    const badSetup = validSuite()
    ;(badSetup.functions[0] as { setup?: unknown }).setup = 5
    expect(messages(badSetup)).toContain(".setup must be a function.")
    const noRunFn = validSuite()
    ;(noRunFn.functions[0] as { run?: unknown }).run = undefined
    expect(messages(noRunFn)).toContain(".run must be a function (or give call and input).")
  })
  it("validates variables, variants, notCovered and inEndToEnd", () => {
    const messages = (mutate: (fn: Suite["functions"][number]) => void): string => {
      const suite = validSuite()
      mutate(suite.functions[0]!)
      try {
        defineSuite(suite)
        return ""
      } catch (error) {
        return (error as SuiteDefinitionError).problems.join("\n")
      }
    }
    expect(
      messages((fn) => {
        fn.variables = [{ name: "", how: "later" as never, description: "short" }]
      }),
    ).toContain("variables[0].name is required.")
    expect(
      messages((fn) => {
        fn.variables = [{ name: "x", how: "fixed", description: "A fixed variable." }]
      }),
    ).toContain('variables[0].value is required for a "fixed" variable')
    expect(
      messages((fn) => {
        fn.variables = [{ name: "x", how: "fixed", value: 1, description: "A fixed variable." }]
      }),
    ).toBe("")
    expect(
      messages((fn) => {
        fn.variants = [{ name: "Bad Name", description: "x" }]
      }),
    ).toContain("variants[0].name must be kebab-case.")
    expect(
      messages((fn) => {
        fn.variants = [{ name: "ok", description: "A real description." }]
      }),
    ).toBe("")
    expect(
      messages((fn) => {
        fn.notCovered = [{ name: "", reason: "short" }]
      }),
    ).toContain("notCovered[0] needs a name and a reason")
    expect(
      messages((fn) => {
        fn.notCovered = [{ name: "x", reason: "A genuine reason here." }]
      }),
    ).toBe("")
    expect(
      messages((fn) => {
        fn.inEndToEnd = { callsPerOperation: "many" as never, description: "A real description." }
      }),
    ).toContain("callsPerOperation must be a number or a function of n.")
    expect(
      messages((fn) => {
        fn.inEndToEnd = { callsPerOperation: (n) => n, description: "A real description." }
      }),
    ).toBe("")
    expect(
      messages((fn) => {
        fn.inEndToEnd = { callsPerOperation: 1, description: "x" }
      }),
    ).toContain("inEndToEnd.description")
  })
  it("exposes the notation for every class", () => {
    expect(COMPLEXITY_NOTATION.quadratic).toBe("O(n²)")
    expect(Object.keys(COMPLEXITY_NOTATION)).toHaveLength(6)
  })
})

describe("call/input shorthand", () => {
  const LADDER = [20, 40, 80, 160]
  const base = () => ({
    tiers: LADDER,
    workload: { unit: "item", description: LONG, typicalN: 80 },
  })
  const messages = (mutate: (fn: Suite["functions"][number]) => void): string => {
    const suite = validSuite(base())
    mutate(suite.functions[0]!)
    try {
      defineSuite(suite)
      return ""
    } catch (error) {
      return (error as SuiteDefinitionError).problems.join("\n")
    }
  }
  it("accepts an imported function plus an argument builder", () => {
    expect(
      messages((fn) => {
        delete fn.run
        delete fn.setup
        fn.call = (a: number, b: number) => a + b
        fn.input = (n) => [n, 1]
      }),
    ).toBe("")
  })
  it("rejects a non-function call, a missing input, and mixing both forms", () => {
    expect(
      messages((fn) => {
        fn.call = 5 as never
        fn.input = (n) => [n]
      }),
    ).toContain(".call must be the function to benchmark.")
    expect(
      messages((fn) => {
        delete fn.run
        fn.call = () => 1
      }),
    ).toContain(".input must be a function of n returning the argument list for call.")
    expect(
      messages((fn) => {
        fn.call = () => 1
        fn.input = (n) => [n]
      }),
    ).toContain("must use either call/input or setup/run, not both.")
  })
  it("invokes call with the arguments input builds at size n, for functions and end-to-end sides", async () => {
    const seen: unknown[][] = []
    const suite = defineSuite(
      validSuite({
        ...base(),
        endToEnd: {
          ...validSuite().endToEnd,
          baseline: {
            description: LONG,
            call: (...args: unknown[]) => {
              seen.push(args)
            },
            input: (n) => [n, "base"],
          },
          withPackage: {
            description: LONG,
            call: (...args: unknown[]) => {
              seen.push(args)
            },
            input: (n, options) => [n, "pkg", options],
          },
        },
        functions: [
          {
            ...validSuite().functions[0]!,
            run: undefined,
            setup: undefined,
            call: (...args: unknown[]) => {
              seen.push(args)
            },
            input: (n: number, options?: unknown) => [n, "fn", options],
            variants: [{ name: "warm", description: "A warm cache.", options: { warm: true } }],
          } as never,
        ],
      }),
    )
    await runSuite(suite, {
      quick: false,
      sampling: {
        warmupIterations: 0,
        minIterations: 1,
        maxIterations: 1,
        targetDurationMs: 0,
        minSampleMs: 0,
      },
      root: process.cwd(),
    })
    expect(seen).toContainEqual([20, "base"])
    expect(seen).toContainEqual([20, "pkg", undefined])
    expect(seen).toContainEqual([20, "fn", { warm: true }])
  })
})

describe("validateResults()", () => {
  it("accepts a real run and reports every departure from the documented shape", async () => {
    const suite = defineSuite(
      validSuite({
        tiers: [20, 40, 80, 160],
        workload: { unit: "item", description: LONG, typicalN: 80 },
      }),
    )
    const results = await runSuite(suite, {
      sampling: {
        warmupIterations: 0,
        minIterations: 1,
        maxIterations: 1,
        targetDurationMs: 0,
        minSampleMs: 0,
      },
      root: process.cwd(),
    })
    expect(validateResults(results)).toEqual([])
    expect(validateResults(null)).toEqual(["results must be an object."])
    const broken = JSON.parse(JSON.stringify(results))
    broken.metadata.schemaVersion = 2
    delete broken.metadata.package
    delete broken.metadata.environment
    broken.metadata.tiers = []
    broken.results["fn:sum"].area = "other"
    broken.results["fn:sum"].tiers.n20.id = 5
    broken.results["fn:sum"].tiers.n20.durationMs.medianMs = "x"
    broken.results["fn:sum"].tiers.n20.cpuMs = null
    broken.results["fn:sum"].tiers.n20.heapDeltaBytes = "y"
    broken.results["fn:sum"].tiers.n40.status = "weird"
    broken.results["fn:sum"].tiers.n80.status = "failed"
    broken.results["fn:sum"].tiers.bad = {
      id: "x",
      status: "failed",
      inputs: {},
      error: { message: "m" },
    }
    broken.results["end-to-end:baseline"].tiers = 3
    delete broken.analysis.complexity
    delete broken.analysis.endToEnd
    delete broken.analysis.contribution
    delete broken.analysis.cost
    const text = validateResults(broken).join("\n")
    for (const expected of [
      "metadata.schemaVersion must be 4",
      "metadata.package.name must be a string",
      "metadata.tiers must list",
      "metadata.environment must be an object",
      '.area must be "end-to-end" or "function"',
      "tiers.n20.id must be a string",
      "durationMs.medianMs must be a finite number",
      "tiers.n20.cpuMs must be a duration-statistics object",
      "tiers.n20.heapDeltaBytes must be a number",
      'tiers.n40.status must be "completed" or "failed"',
      "tiers.n80.error.message must be a string",
      'tier names look like "n640"',
      "tiers must be an object",
      "analysis.complexity must be an object",
      "analysis.endToEnd must be an array",
      "analysis.contribution must be an array",
      "analysis.cost must be an object",
    ]) {
      expect(text).toContain(expected)
    }
    expect(validateResults({ metadata: 1, results: 1, analysis: 1 })).toEqual([
      "metadata must be an object.",
      "results must map each group to its tiers.",
      "analysis must be an object.",
    ])
  })
  it("tolerates derived entries without CPU or heap data", async () => {
    const suite = defineSuite(
      validSuite({
        tiers: [20, 40, 80, 160],
        workload: { unit: "item", description: LONG, typicalN: 80 },
      }),
    )
    const results = await runSuite(suite, {
      sampling: {
        warmupIterations: 0,
        minIterations: 1,
        maxIterations: 1,
        targetDurationMs: 0,
        minSampleMs: 0,
      },
      root: process.cwd(),
    })
    results.results["end-to-end:overhead"] = {
      area: "end-to-end",
      derived: true,
      tiers: {
        n20: {
          id: "o",
          status: "completed",
          derived: true,
          inputs: { item: 20 },
          durationMs: results.results["fn:sum"].tiers.n20.durationMs,
        },
      },
    }
    expect(validateResults(results)).toEqual([])
  })
})

describe("per-variant expectations", () => {
  const LADDER = [20, 40, 80, 160]
  const base = () => ({
    tiers: LADDER,
    workload: { unit: "item", description: LONG, typicalN: 80 },
  })
  const withVariants = () =>
    validSuite({
      ...base(),
      functions: [
        {
          ...validSuite().functions[0]!,
          variants: [
            { name: "all", description: "Everything is processed." },
            {
              name: "scoped",
              description: "Only one item is processed.",
              expectedComplexity: "constant",
              complexityReason:
                "Scoping selects a single item, so the input size no longer matters.",
            },
          ],
        },
      ],
    })
  it("uses a variant's own expectation, falling back to the function's", () => {
    const fn = withVariants().functions[0]!
    expect(expectationOf(fn, fn.variants![0])).toEqual({
      expectedComplexity: "linear",
      complexityReason: LONG,
    })
    expect(expectationOf(fn, fn.variants![1])).toMatchObject({ expectedComplexity: "constant" })
    expect(expectationOf(fn, undefined).expectedComplexity).toBe("linear")
  })
  it("validates a variant's expectation and reason", () => {
    const messages = (
      mutate: (v: {
        name: string
        description: string
        expectedComplexity?: string
        complexityReason?: string
      }) => void,
    ): string => {
      const suite = withVariants()
      mutate(suite.functions[0]!.variants![1] as never)
      try {
        defineSuite(suite)
        return ""
      } catch (error) {
        return (error as SuiteDefinitionError).problems.join("\n")
      }
    }
    expect(messages(() => undefined)).toBe("")
    expect(
      messages((v) => {
        v.expectedComplexity = "fast"
      }),
    ).toContain("variants[1].expectedComplexity must be one of")
    expect(
      messages((v) => {
        v.complexityReason = ""
      }),
    ).toContain("variants[1].complexityReason (why this variant differs)")
  })
  it("compares each variant with its own expectation in the analysis and the report", async () => {
    const suite = defineSuite(withVariants())
    const group = (fn: (n: number) => number) => ({
      area: "function",
      tiers: Object.fromEntries(LADDER.map((n) => [tierName(n), entry(n, fn(n))])),
    })
    const results = { "fn:sum@all": group((n) => n * 0.1), "fn:sum@scoped": group(() => 1) }
    const analysis = analyze({ suite, results, tiers: LADDER })
    expect(analysis.complexity["fn:sum@all"]).toMatchObject({
      expected: "linear",
      agreement: "matches",
    })
    expect(analysis.complexity["fn:sum@scoped"]).toMatchObject({
      expected: "constant",
      agreement: "matches",
    })
    const text = renderReport({ ...fakeResultsShell(suite), results, analysis }, suite)
    expect(text).toContain("**Expected for this variant: O(1).** Scoping selects a single item")
  })
})

describe("agreement()", () => {
  it("compares measured with documented class", () => {
    expect(agreement(null, "linear")).toBe("unknown")
    expect(agreement("linear", "linear")).toBe("matches")
    expect(agreement("linearithmic", "linear")).toBe("close")
    expect(agreement("logarithmic", "constant")).toBe("close")
    expect(agreement("quadratic", "linear")).toBe("differs")
    expect(agreement("constant", "quadratic")).toBe("differs")
  })
})

function entry(n: number, medianMs: number, extra: Record<string, unknown> = {}) {
  return {
    id: `x@n${String(n)}`,
    status: "completed",
    inputs: { item: n },
    durationMs: {
      medianMs,
      p95Ms: medianMs * 1.2,
      minMs: medianMs,
      maxMs: medianMs,
      stdDevMs: 0,
      iterations: 5,
      warmupIterations: 1,
    },
    cpuMs: { medianMs: medianMs / 2 },
    heapDeltaBytes: n * 10,
    opsPerSecond: 1000 / medianMs,
    ...extra,
  }
}

describe("analyze()", () => {
  const tiers = [20, 40, 80, 160]
  const suite = defineSuite(
    validSuite({ tiers, workload: { unit: "item", description: LONG, typicalN: 80 } }),
  )
  const group = (area: string, fn: (n: number) => number, extra: Record<string, unknown> = {}) => ({
    area,
    tiers: Object.fromEntries(tiers.map((n) => [tierName(n), entry(n, fn(n), extra)])),
  })
  const results = {
    "end-to-end:baseline": group("end-to-end", () => 1),
    "end-to-end:with-package": group("end-to-end", (n) => 1 + n * 0.1),
    "fn:sum": group("function", (n) => n * 0.1),
  }

  it("classifies every group and compares documented groups with their expectation", () => {
    const { complexity } = analyze({ suite, results, tiers })
    expect(complexity["fn:sum"]).toMatchObject({
      class: "linear",
      notation: "O(n)",
      expected: "linear",
      expectedNotation: "O(n)",
      agreement: "matches",
    })
    expect(complexity["end-to-end:baseline"]).toMatchObject({ class: "constant" })
    expect(complexity["end-to-end:baseline"]).not.toHaveProperty("expected")
  })
  it("derives end-to-end overhead, percent, CPU, heap and cost per size", () => {
    const { endToEnd } = analyze({ suite, results, tiers })
    expect(endToEnd.map((r: { n: number }) => r.n)).toEqual(tiers)
    const at80 = endToEnd[2]
    expect(at80.baselineMs).toBe(1)
    expect(at80.withPackageMs).toBeCloseTo(9, 10)
    expect(at80.overheadMs).toBeCloseTo(8, 10)
    expect(at80.overheadPercent).toBeCloseTo(800, 8)
    expect(at80.overheadCpuMs).toBeCloseTo(4, 10)
    expect(at80.overheadHeapBytes).toBe(0)
    expect(at80.cost.opsPerSecondPerCore).toBeCloseTo(125, 8)
  })
  it("clamps negative overhead to zero and reports null percent for a zero baseline", () => {
    const noisy = {
      "end-to-end:baseline": group("end-to-end", () => 0),
      "end-to-end:with-package": group("end-to-end", () => 0),
    }
    const { endToEnd } = analyze({ suite, results: noisy, tiers })
    expect(endToEnd[0].overheadMs).toBe(0)
    expect(endToEnd[0].overheadPercent).toBeNull()
    const faster = analyze({
      suite,
      results: { ...results, "end-to-end:with-package": group("end-to-end", () => 0.5) },
      tiers,
    })
    expect(faster.endToEnd[0].overheadMs).toBe(0)
  })
  it("skips sizes where either side failed", () => {
    const failed = {
      ...results,
      "end-to-end:baseline": {
        area: "end-to-end",
        tiers: {
          ...results["end-to-end:baseline"].tiers,
          n20: { id: "x", status: "failed", inputs: { item: 20 } },
        },
      },
    }
    expect(
      analyze({ suite, results: failed, tiers }).endToEnd.map((r: { n: number }) => r.n),
    ).toEqual([40, 80, 160])
  })
  it("attributes overhead to functions using calls per operation", () => {
    const { contribution } = analyze({ suite, results, tiers })
    expect(contribution).toHaveLength(1)
    const row = contribution[0].rows[2]
    expect(row.calls).toBe(1)
    expect(row.estimatedMs).toBeCloseTo(8, 10)
    expect(row.exclusiveMs).toBeCloseTo(8, 10)
    expect(row).not.toHaveProperty("shareOfOverhead")
    expect(row.shareOfTotal).toBeCloseTo(8 / 9, 10)
  })
  it("supports a function-of-n call count, a named variant, and zero overhead", () => {
    const withVariant = defineSuite(
      validSuite({
        tiers,
        workload: { unit: "item", description: LONG, typicalN: 80 },
        functions: [
          {
            ...validSuite().functions[0]!,
            variants: [
              { name: "cold", description: "A cold cache." },
              { name: "warm", description: "A warm cache." },
            ],
            inEndToEnd: {
              callsPerOperation: (n) => n,
              description: "Once per item.",
              variant: "warm",
            },
          },
        ],
      }),
    )
    const variantResults = {
      ...results,
      "fn:sum@cold": group("function", () => 100),
      "fn:sum@warm": group("function", () => 0.01),
    }
    const { contribution } = analyze({ suite: withVariant, results: variantResults, tiers })
    expect(contribution[0].group).toBe("fn:sum@warm")
    expect(contribution[0].rows[1].calls).toBe(40)
    expect(contribution[0].rows[1].estimatedMs).toBeCloseTo(0.4, 10)
    const flat = analyze({
      suite: withVariant,
      results: { ...variantResults, "end-to-end:with-package": group("end-to-end", () => 1) },
      tiers,
    })
    // Shares are against the whole operation, so a zero-overhead run still attributes sensibly.
    expect(flat.contribution[0].rows[0].shareOfTotal).toBeCloseTo(
      flat.contribution[0].rows[0].exclusiveMs / 1,
      10,
    )
  })
  it("subtracts the time of a function it includes, so nested calls are counted once", () => {
    const base = validSuite({ tiers, workload: { unit: "item", description: LONG, typicalN: 80 } })
    const outer = {
      ...base.functions[0]!,
      inEndToEnd: {
        callsPerOperation: 1,
        description: "Calls inner once.",
        includes: ["inner"],
      },
    }
    const inner = {
      ...base.functions[0]!,
      id: "inner",
      name: "inner",
      inEndToEnd: { callsPerOperation: 2, description: "Called by outer, twice." },
    }
    const nested = defineSuite({ ...base, functions: [outer, inner] })
    const nestedResults = {
      ...results,
      "fn:sum": group("function", () => 10),
      "fn:inner": group("function", () => 1),
    }
    const { contribution } = analyze({ suite: nested, results: nestedResults, tiers })
    const [first, second] = contribution
    expect(first!.rows[0].estimatedMs).toBe(10)
    expect(first!.rows[0].exclusiveMs).toBe(8)
    expect(second!.rows[0].exclusiveMs).toBe(2)
    // never negative, even when the nested time exceeds the outer's own measurement
    const tiny = analyze({
      suite: nested,
      results: { ...nestedResults, "fn:sum": group("function", () => 0.5) },
      tiers,
    })
    expect(tiny.contribution[0]!.rows[0].exclusiveMs).toBe(0)
  })
  it("rejects an includes list that names itself, an unknown function, or is not a list", () => {
    const base = validSuite({ tiers, workload: { unit: "item", description: LONG, typicalN: 80 } })
    const problems = (includes: unknown) => {
      try {
        defineSuite({
          ...base,
          functions: [
            {
              ...base.functions[0]!,
              inEndToEnd: {
                callsPerOperation: 1,
                description: "A real description.",
                includes: includes as string[] | undefined,
              },
            },
          ],
        })
        return []
      } catch (error) {
        return (error as { problems: string[] }).problems
      }
    }
    expect(problems(["sum"])).toContain(
      "functions[0] (sum).inEndToEnd.includes cannot list itself.",
    )
    expect(problems(["ghost"])).toContain(
      'functions[0] (sum).inEndToEnd.includes names "ghost", which is not a function in this suite.',
    )
    expect(problems("sum")).toContain(
      "functions[0] (sum).inEndToEnd.includes must be a list of function ids.",
    )
    expect(problems([3])).toContain(
      "functions[0] (sum).inEndToEnd.includes must be a list of function ids.",
    )
    expect(problems(undefined)).toEqual([])
  })
  it("ignores functions without inEndToEnd and sizes a variant lacks", () => {
    const plain = validSuite({ tiers })
    delete (plain.functions[0] as { inEndToEnd?: unknown }).inEndToEnd
    const none = analyze({
      suite: defineSuite({ ...plain, workload: { unit: "item", description: LONG, typicalN: 80 } }),
      results,
      tiers,
    })
    expect(none.contribution).toEqual([])
    const partial = analyze({
      suite,
      results: { ...results, "fn:sum": { area: "function", tiers: { n20: entry(20, 2) } } },
      tiers,
    })
    expect(partial.contribution[0].rows).toHaveLength(1)
  })
  it("picks the measured size nearest the typical one, and the last as largest", () => {
    const { cost } = analyze({
      suite: defineSuite(
        validSuite({ tiers, workload: { unit: "item", description: LONG, typicalN: 160 } }),
      ),
      results,
      tiers: [20, 40],
    })
    expect(cost.typicalN).toBe(40)
    const none = analyze({ suite, results: {}, tiers })
    expect(none.cost.typical).toBeUndefined()
    expect(none.cost.typicalN).toBe(80)
  })
})

describe("runSuite() and renderReport()", () => {
  const smallSuite = defineSuite(
    validSuite({
      tiers: [20, 40, 80, 160],
      workload: { unit: "item", description: LONG, typicalN: 80 },
    }),
  )
  const fixed = [new Date("2026-01-01T00:00:00.000Z"), new Date("2026-01-01T00:00:05.000Z")]
  const run = (options = {}) => {
    let call = 0
    return runSuite(smallSuite, {
      sampling: {
        warmupIterations: 0,
        minIterations: 2,
        maxIterations: 2,
        targetDurationMs: 0,
        minSampleMs: 0,
      },
      now: () => fixed[Math.min(call++, 1)] as Date,
      root: process.cwd(),
      ...options,
    })
  }

  it("measures every group at every tier and records metadata", async () => {
    const results = await run()
    expect(Object.keys(results.results)).toEqual(
      ["end-to-end:baseline", "end-to-end:with-package", "fn:sum", "end-to-end:overhead"].filter(
        (key) => key in results.results,
      ),
    )
    expect(results.results["fn:sum"].tiers.n80).toMatchObject({
      status: "completed",
      inputs: { item: 80 },
    })
    expect(results.results["fn:sum"].tiers.n80.durationMs.iterations).toBe(2)
    expect(results.metadata).toMatchObject({
      schemaVersion: 4,
      package: { name: "demo" },
      tiers: [20, 40, 80, 160],
      timing: {
        startedAtUtc: "2026-01-01T00:00:00.000Z",
        finishedAtUtc: "2026-01-01T00:00:05.000Z",
        totalSuiteDurationMs: 5000,
      },
      versions: { demo: "1.2.3" },
    })
    expect(results.metadata.costRates).toEqual(DEFAULT_RATES)
    expect(results.analysis.complexity["fn:sum"].expected).toBe("linear")
  })
  it("uses the quick ladder and short sampling for --quick, and honours --only", async () => {
    const quick = await runSuite(smallSuite, { quick: true, only: ["sum"], root: process.cwd() })
    expect(quick.metadata.tiers).toEqual([20, 40, 80, 160, 320])
    expect(Object.keys(quick.results)).toEqual(["fn:sum"])
    expect(quick.analysis.endToEnd).toEqual([])
  })
  it("emits the overhead as its own derived group only where it is positive", async () => {
    const results = await run()
    const overhead = results.results["end-to-end:overhead"]
    if (overhead) {
      expect(overhead.derived).toBe(true)
      for (const entry of Object.values(overhead.tiers) as {
        derived: boolean
        durationMs: { medianMs: number }
      }[]) {
        expect(entry.derived).toBe(true)
        expect(entry.durationMs.medianMs).toBeGreaterThan(0)
      }
    }
  })
  it("records a failing function as a failed tier instead of aborting", async () => {
    const failing = defineSuite(
      validSuite({
        tiers: [20, 40, 80, 160],
        workload: { unit: "item", description: LONG, typicalN: 80 },
        functions: [
          {
            ...validSuite().functions[0]!,
            run: () => {
              throw new TypeError("boom")
            },
          },
        ],
      }),
    )
    const results = await runSuite(failing, {
      sampling: {
        warmupIterations: 0,
        minIterations: 1,
        maxIterations: 1,
        targetDurationMs: 0,
        minSampleMs: 0,
      },
      only: ["sum"],
      root: process.cwd(),
    })
    expect(results.results["fn:sum"].tiers.n20).toEqual({
      id: "fn:sum@n20",
      status: "failed",
      inputs: { item: 20 },
      error: { name: "TypeError", message: "boom" },
    })
  })
  it("builds fresh state per sample and tears it down", async () => {
    const events: string[] = []
    const fresh = defineSuite(
      validSuite({
        tiers: [20, 40, 80, 160],
        workload: { unit: "item", description: LONG, typicalN: 80 },
        functions: [
          {
            ...validSuite().functions[0]!,
            fresh: true,
            setup: (n) => {
              events.push("setup")
              return n
            },
            run: () => {
              events.push("run")
            },
            teardown: () => {
              events.push("teardown")
            },
          },
        ],
      }),
    )
    await runSuite(fresh, {
      sampling: {
        warmupIterations: 0,
        minIterations: 1,
        maxIterations: 1,
        targetDurationMs: 0,
        minSampleMs: 0,
      },
      only: ["sum"],
      root: process.cwd(),
    })
    expect(events.slice(0, 3)).toEqual(["setup", "run", "teardown"])
  })
  it("reports the options' bundle files and cost rates", async () => {
    const results = await run({
      rates: { vCpuHourUsd: 1 },
      bundleFiles: ["package.json", "missing.js"],
    })
    expect(results.metadata.costRates.vCpuHourUsd).toBe(1)
    expect(results.metadata.bundleSizes["package.json"].gzipBytes).toBeGreaterThan(0)
    expect(results.metadata.bundleSizes["missing.js"]).toEqual({ bytes: null, gzipBytes: null })
  })

  it("renders a cost-first report with every documented section", async () => {
    const results = await run()
    const report = renderReport(results, smallSuite)
    for (const heading of [
      "# demo: performance and cost report",
      "## What adopting this package costs",
      "## 1. End-to-end: the package's total impact",
      "## 2. Function by function",
      "### `sum`",
      "## 3. What makes up one end-to-end operation",
      "## Cost model",
      "## Environment and method",
    ]) {
      expect(report).toContain(heading)
    }
    expect(report.indexOf("What adopting this package costs")).toBeLessThan(
      report.indexOf("## 1. End-to-end"),
    )
    expect(report).toContain("**Why we benchmark it.**")
    expect(report).toContain("**What poor performance would mean.**")
    expect(report).toContain("**Expected growth: O(n).**")
    expect(report).toContain("READING-BENCHMARKS.md")
    expect(report).toContain("Do not compare these numbers")
  })
  it("links the reading guide next to the report by default, or under docsPath", async () => {
    const results = await run()
    expect(renderReport(results, smallSuite)).toContain("](READING-BENCHMARKS.md)")
    expect(renderReport(results, smallSuite, { docsPath: ".." })).toContain(
      "](../READING-BENCHMARKS.md)",
    )
    expect(renderReport(results, smallSuite, { docsPath: ".." })).not.toContain(
      "](READING-BENCHMARKS.md)",
    )
  })
  it("explains gaps instead of crashing: no end-to-end data, no attribution, failures", async () => {
    const onlyFn = await runSuite(smallSuite, {
      only: ["sum"],
      sampling: {
        warmupIterations: 0,
        minIterations: 1,
        maxIterations: 1,
        targetDurationMs: 0,
        minSampleMs: 0,
      },
      root: process.cwd(),
    })
    const report = renderReport(onlyFn, smallSuite)
    expect(report).toContain("produced no complete result at the typical workload size")
    const failing = defineSuite(
      validSuite({
        tiers: [20, 40, 80, 160],
        workload: { unit: "item", description: LONG, typicalN: 80 },
        functions: [
          {
            ...validSuite().functions[0]!,
            inEndToEnd: undefined,
            run: () => {
              throw new Error("bad")
            },
            notCovered: [{ name: "threads", reason: "Single threaded by design." }],
            variants: [{ name: "cold", description: "A cold cache." }],
          },
        ],
      }),
    )
    const failedRun = await runSuite(failing, {
      only: ["sum"],
      sampling: {
        warmupIterations: 0,
        minIterations: 1,
        maxIterations: 1,
        targetDurationMs: 0,
        minSampleMs: 0,
      },
      root: process.cwd(),
    })
    const failedReport = renderReport(failedRun, failing)
    expect(failedReport).toContain("## Failed measurements")
    expect(failedReport).toContain("❌ bad")
    expect(failedReport).toContain("**Deliberately not covered**")
    expect(failedReport).toContain("Variant `cold`")
    expect(failedReport).toContain("not enough data")
    const noCalls = defineSuite(
      validSuite({
        tiers: [20, 40, 80, 160],
        workload: { unit: "item", description: LONG, typicalN: 80 },
        functions: [{ ...validSuite().functions[0]!, inEndToEnd: undefined }],
      }),
    )
    const noAttribution = renderReport(
      await runSuite(noCalls, {
        sampling: {
          warmupIterations: 0,
          minIterations: 1,
          maxIterations: 1,
          targetDurationMs: 0,
          minSampleMs: 0,
        },
        root: process.cwd(),
      }),
      noCalls,
    )
    expect(noAttribution).toContain("No function declared how it is used in the end-to-end run")
  })
})

describe("per-function ladders and sampling", () => {
  const LADDER = [20, 40, 80, 160]
  const base = () => ({
    tiers: LADDER,
    workload: { unit: "item", description: LONG, typicalN: 80 },
  })
  it("accepts a shorter ladder only with a reason, and validates it", () => {
    const messages = (mutate: (fn: Suite["functions"][number]) => void): string => {
      const suite = validSuite(base())
      mutate(suite.functions[0]!)
      try {
        defineSuite(suite)
        return ""
      } catch (error) {
        return (error as SuiteDefinitionError).problems.join("\n")
      }
    }
    expect(
      messages((fn) => {
        fn.tiers = [10, 20, 40, 80]
        fn.tiersReason = "The function refuses more than one hundred attempts."
      }),
    ).toBe("")
    expect(
      messages((fn) => {
        fn.tiers = [10, 20, 40, 80]
      }),
    ).toContain("tiersReason")
    expect(
      messages((fn) => {
        fn.tiers = [10, 20, 30]
        fn.tiersReason = "The function refuses more than one hundred attempts."
      }),
    ).toContain("tiers must list at least 4 sizes")
  })
  it("measures a function on its own ladder and lets it override sampling", async () => {
    const suite = defineSuite(
      validSuite({
        ...base(),
        functions: [
          {
            ...validSuite().functions[0]!,
            tiers: [5, 10, 15, 20],
            tiersReason: "The function is only defined up to twenty.",
            sampling: {
              minIterations: 3,
              maxIterations: 3,
              warmupIterations: 0,
              targetDurationMs: 0,
              minSampleMs: 0,
            },
          },
        ],
      }),
    )
    const results = await runSuite(suite, { only: ["sum"], root: process.cwd() })
    expect(Object.keys(results.results["fn:sum"].tiers)).toEqual(["n5", "n10", "n15", "n20"])
    expect(results.results["fn:sum"].tiers.n5.durationMs.iterations).toBe(3)
    const report = renderReport(results, suite)
    expect(report).toContain(
      "**Measured on a shorter ladder (5, 10, 15, 20).** The function is only defined up to twenty.",
    )
  })
  it("applies sampling overrides to the end-to-end sides too", async () => {
    const suite = defineSuite(
      validSuite({
        ...base(),
        endToEnd: {
          ...validSuite().endToEnd,
          baseline: {
            ...validSuite().endToEnd.baseline,
            sampling: {
              minIterations: 2,
              maxIterations: 2,
              warmupIterations: 0,
              targetDurationMs: 0,
              minSampleMs: 0,
            },
          },
        },
      }),
    )
    const results = await runSuite(suite, {
      only: ["end-to-end"],
      sampling: {
        minIterations: 4,
        maxIterations: 4,
        warmupIterations: 0,
        targetDurationMs: 0,
        minSampleMs: 0,
      },
      root: process.cwd(),
    })
    expect(results.results["end-to-end:baseline"].tiers.n20.durationMs.iterations).toBe(2)
    expect(results.results["end-to-end:with-package"].tiers.n20.durationMs.iterations).toBe(4)
  })
  it("falls back to the nearest measured size for the typical workload when there is no end-to-end data", () => {
    const suite = defineSuite(
      validSuite({ ...base(), workload: { unit: "item", description: LONG, typicalN: 160 } }),
    )
    expect(analyze({ suite, results: {}, tiers: [20, 40] }).cost.typicalN).toBe(40)
  })
})

function fakeResultsShell(suite: Suite) {
  return {
    metadata: {
      package: { name: "demo" },
      workload: suite.workload,
      tiers: [20, 40, 80, 160],
      bundleSizes: {},
      costRates: DEFAULT_RATES,
      timing: { startedAtUtc: "a", finishedAtUtc: "b", totalSuiteDurationMs: 1 },
      environment: {
        cpuModel: null,
        logicalCores: 1,
        physicalCores: null,
        totalMemoryMb: 1,
        platform: "x",
        processArch: "y",
        nodeVersion: "v",
        runner: "local",
      },
      git: { gitCommit: null, gitBranch: null, gitDirty: false },
      generatedBy: "t",
    },
  }
}

describe("report presentation", () => {
  const fakeResults = (baselineMs: number, withMs: number, cpuWithMs: number) => {
    const tiers = [20, 40, 80, 160]
    const suite = defineSuite(
      validSuite({ tiers, workload: { unit: "item", description: LONG, typicalN: 80 } }),
    )
    const group = (area: string, ms: number, cpu: number) => ({
      area,
      tiers: Object.fromEntries(
        tiers.map((n) => [tierName(n), entry(n, ms, { cpuMs: { medianMs: cpu } })]),
      ),
    })
    const results = {
      "end-to-end:baseline": group("end-to-end", baselineMs, baselineMs),
      "end-to-end:with-package": group("end-to-end", withMs, cpuWithMs),
      "fn:sum": group("function", withMs, withMs),
    }
    const analysis = analyze({ suite, results, tiers })
    return {
      suite,
      results: {
        metadata: {
          package: { name: "demo" },
          workload: suite.workload,
          tiers,
          bundleSizes: {},
          costRates: DEFAULT_RATES,
          timing: { startedAtUtc: "a", finishedAtUtc: "b", totalSuiteDurationMs: 1 },
          environment: {
            cpuModel: null,
            logicalCores: 1,
            physicalCores: null,
            totalMemoryMb: 1,
            platform: "x",
            processArch: "y",
            nodeVersion: "v",
            runner: "local",
          },
          git: { gitCommit: null, gitBranch: null, gitDirty: false },
          generatedBy: "t",
        },
        results,
        analysis,
      },
    }
  }
  it("shows an enormous relative overhead as a multiple of the baseline, and a modest one as a percent", () => {
    const huge = fakeResults(0.0001, 0.2, 0.2)
    expect(renderReport(huge.results, huge.suite)).toContain("× baseline")
    const modest = fakeResults(1, 1.5, 1.5)
    const text = renderReport(modest.results, modest.suite)
    expect(text).toContain("50%")
    expect(text).not.toContain("× baseline")
    const tiny = fakeResults(10, 10.5, 10.5)
    expect(renderReport(tiny.results, tiny.suite)).toContain("5.0%")
  })
  it("shows a function's nearest measured size, labelled, and calls out functions that differ from their documentation", async () => {
    const tiers = [20, 40, 80, 160]
    const suite = defineSuite(
      validSuite({ tiers, workload: { unit: "item", description: LONG, typicalN: 160 } }),
    )
    const group = (area: string, fn: (n: number) => number) => ({
      area,
      tiers: Object.fromEntries([20, 40].map((n) => [tierName(n), entry(n, fn(n))])),
    })
    const quadratic = group("function", (n) => n * n)
    const results = {
      "end-to-end:baseline": group("end-to-end", () => 1),
      "end-to-end:with-package": group("end-to-end", () => 2),
      "fn:sum": quadratic,
    }
    const analysis = analyze({ suite, results, tiers })
    const text = renderReport({ ...fakeResults(1, 2, 2).results, results, analysis }, suite)
    expect(text).toContain("(at 40)")
    expect(text).toContain("> **Needs attention.**")
    expect(text).toContain("> - `sum`: documented O(n), measured O(n²) (exponent 2.00)")
  })
  it("prints a price range smallest first even when CPU time exceeds wall time", () => {
    const { suite, results } = fakeResults(0.001, 0.5, 5)
    const text = renderReport(results, suite)
    const row = text.split("\n").find((line) => line.startsWith("| 80 |"))!
    const cells = row.split("|").map((cell) => cell.trim())
    const [low, high] = (cells[7] as string)
      .split(" – ")
      .map((value) => Number(value.replace("$", "")))
    expect(low).toBeLessThan(high as number)
  })
})

describe("formatters", () => {
  it("formats durations across units", () => {
    expect(formatMs(Number.NaN)).toBe("n/a")
    expect(formatMs(0)).toBe("0")
    expect(formatMs(0.0005)).toBe("0.500 µs")
    expect(formatMs(12.3456)).toBe("12.3 ms")
    expect(formatMs(999.9)).toBe("1.00e+3 ms")
    expect(formatMs(2500)).toBe("2.50 s")
  })
  it("formats byte sizes, including negative heap deltas", () => {
    expect(formatBytes(Number.NaN)).toBe("n/a")
    expect(formatBytes(512)).toBe("512 B")
    expect(formatBytes(2048)).toBe("2.0 KiB")
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MiB")
    expect(formatBytes(-2048)).toBe("-2.0 KiB")
  })
})
