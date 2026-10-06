import { describe, expect, it } from "vitest"
import {
  DEFAULT_RATES,
  analyze,
  defineSuite,
  formatBytes,
  formatMs,
  renderReport,
  tierName,
} from "../scripts/benchmark/kit/index.mjs"
import type { Suite } from "../scripts/benchmark/kit/index.mjs"

const LONG = "A sufficiently long and honest explanation."
const TIERS = [20, 40, 80, 160]

function suiteWith(overrides: Partial<Suite> = {}): Suite {
  return defineSuite({
    package: { name: "demo", version: "1.2.3" },
    workload: { unit: "item", description: "One item processed per unit of n.", typicalN: 80 },
    tiers: TIERS,
    endToEnd: {
      purpose: "Measures what routing the workload through the package adds.",
      baseline: { description: "Process items directly.", setup: (n) => n, run: (n) => n },
      withPackage: {
        description: "Process items via the package.",
        setup: (n) => n,
        run: (n) => n,
      },
      variables: [
        { name: "items", how: "swept", description: "The tier axis." },
        { name: "mode", how: "fixed", value: "strict", description: "Validation mode." },
      ],
    },
    functions: [
      {
        id: "sum",
        name: "sum",
        why: "Adds the items up, once per operation.",
        poorPerformanceMeans: "Every operation pays for the slow sum.",
        expectedComplexity: "linear",
        complexityReason: LONG,
        variables: [{ name: "items", how: "swept", description: "The tier axis." }],
        inEndToEnd: { callsPerOperation: 2, description: "Called twice per operation." },
        setup: (n) => n,
        run: (n) => n,
      },
      {
        id: "lookup",
        name: "lookup",
        why: "Finds one item by key.",
        poorPerformanceMeans: "Lookups slow down as the set grows.",
        expectedComplexity: "constant",
        complexityReason: "A hash lookup does not depend on the number of items.",
        variables: [
          { name: "keys", how: "fixed", value: 1, description: "A single key per lookup." },
        ],
        inEndToEnd: { callsPerOperation: 1, description: "Called once per operation." },
        setup: (n) => n,
        run: (n) => n,
      },
    ],
    ...overrides,
  } as Suite)
}

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

const group = (area: string, fn: (n: number) => number, tiers = TIERS) => ({
  area,
  tiers: Object.fromEntries(tiers.map((n) => [tierName(n), entry(n, fn(n))])),
})

function metadata(suite: Suite, overrides: Record<string, unknown> = {}) {
  return {
    package: { name: "demo" },
    workload: suite.workload,
    tiers: TIERS,
    bundleSizes: {},
    costRates: DEFAULT_RATES,
    timing: {
      startedAtUtc: "2026-01-01T00:00:00.000Z",
      finishedAtUtc: "2026-01-01T00:00:05.000Z",
      totalSuiteDurationMs: 5000,
    },
    environment: {
      cpuModel: "Test CPU",
      logicalCores: 8,
      physicalCores: 4,
      totalMemoryMb: 16384,
      platform: "linux",
      processArch: "x64",
      nodeVersion: "v24.0.0",
      runner: "ci",
    },
    git: { gitCommit: "abc1234", gitBranch: "main", gitDirty: false },
    generatedBy: "test",
    ...overrides,
  }
}

describe("renderReport -- exact output", () => {
  it("a complete run: costs, end-to-end, every function, contributions, bundle size and a failed size", async () => {
    const suite = suiteWith()
    const results = {
      "end-to-end:baseline": group("end-to-end", (n) => 0.01 * n),
      "end-to-end:with-package": group("end-to-end", (n) => 0.03 * n + 0.2),
      "fn:sum": group("function", (n) => 0.01 * n),
      "fn:lookup": group("function", () => 0.05),
    }
    ;(results["fn:lookup"].tiers as Record<string, unknown>)["n160"] = {
      id: "lookup@n160",
      status: "failed",
      inputs: { item: 160 },
      error: { name: "RangeError", message: "boom" },
    }
    const analysis = analyze({ suite, results, tiers: TIERS })
    const text = renderReport(
      {
        metadata: metadata(suite, {
          bundleSizes: {
            "dist/index.js": { gzipBytes: 2048 },
            "dist/other.js": { gzipBytes: 1024 },
          },
        }),
        results,
        analysis,
      },
      suite,
    )
    await expect(text).toMatchFileSnapshot("./__snapshots__/benchmark-report-complete.snap")
  })

  it("links the reading guide under a docs path and omits the cold-start row without bundle sizes", async () => {
    const suite = suiteWith()
    const results = {
      "end-to-end:baseline": group("end-to-end", () => 1),
      "end-to-end:with-package": group("end-to-end", () => 1.5),
      "fn:sum": group("function", () => 1),
      "fn:lookup": group("function", () => 1),
    }
    const analysis = analyze({ suite, results, tiers: TIERS })
    const text = renderReport({ metadata: metadata(suite), results, analysis }, suite, {
      docsPath: "benchmarks",
    })
    await expect(text).toMatchFileSnapshot("./__snapshots__/benchmark-report-docs-path.snap")
  })

  it("says so when no size could be measured end to end", async () => {
    const suite = suiteWith()
    const failed = Object.fromEntries(
      TIERS.map((n) => [
        tierName(n),
        {
          id: `x@n${String(n)}`,
          status: "failed",
          inputs: { item: n },
          error: { name: "Error", message: "no" },
        },
      ]),
    )
    const results = {
      "end-to-end:baseline": { area: "end-to-end", tiers: failed },
      "end-to-end:with-package": { area: "end-to-end", tiers: failed },
      "fn:sum": group("function", () => 1),
      "fn:lookup": group("function", () => 1),
    }
    const analysis = analyze({ suite, results, tiers: TIERS })
    const text = renderReport({ metadata: metadata(suite), results, analysis }, suite)
    await expect(text).toMatchFileSnapshot("./__snapshots__/benchmark-report-no-end-to-end.snap")
  })
})

describe("renderReport -- the rarer branches", () => {
  const RICH = [20, 40, 80, 160, 320]
  const richSuite = () =>
    suiteWith({
      tiers: RICH,
      functions: [
        {
          id: "scan",
          name: "scan",
          why: "Scans the whole set once.",
          poorPerformanceMeans: "Scans dominate every operation.",
          expectedComplexity: "linear",
          complexityReason: LONG,
          tiers: [20, 40, 80, 160],
          tiersReason: "Larger sizes take minutes and add no information.",
          variables: [{ name: "items", how: "swept", description: "The tier axis." }],
          notCovered: [{ name: "disk cache", reason: "Needs a real filesystem." }],
          variants: [
            { name: "all", description: "Everything is scanned." },
            {
              name: "one",
              description: "A single item is scanned.",
              expectedComplexity: "constant",
              complexityReason: "One item does not depend on n.",
            },
          ],
          setup: (n) => n,
          run: (n) => n,
        },
        {
          id: "plain",
          name: "plain",
          why: "A function that is never part of the end-to-end run.",
          poorPerformanceMeans: "Nothing user-visible.",
          expectedComplexity: "constant",
          complexityReason: "A fixed number of steps.",
          variables: [{ name: "keys", how: "fixed", value: 3, description: "Three keys, always." }],
          setup: (n) => n,
          run: (n) => n,
        },
      ],
    } as Partial<Suite>)

  it("shows shorter ladders, uncovered scope, variants, missing and partial measurements and an unknown machine", async () => {
    const suite = richSuite()
    const results = {
      "end-to-end:baseline": group("end-to-end", () => 1, RICH),
      "end-to-end:with-package": group("end-to-end", () => 2, RICH),
      "fn:scan@all": group("function", (n) => n * 0.1, [20, 40, 80, 160]),
      "fn:scan@one": {
        area: "function",
        tiers: {
          n20: entry(20, 1, { opsPerSecond: null }),
          n40: { id: "scan@n40", status: "failed", inputs: { item: 40 } },
          n80: {
            id: "scan@n80",
            status: "failed",
            inputs: { item: 80 },
            error: { name: "TypeError" },
          },
        },
      },
    }
    const analysis = analyze({ suite, results, tiers: RICH })
    const text = renderReport(
      {
        metadata: metadata(suite, {
          tiers: RICH,
          environment: {
            cpuModel: null,
            logicalCores: 2,
            physicalCores: null,
            totalMemoryMb: 4096,
            platform: "darwin",
            processArch: "arm64",
            nodeVersion: "v22.0.0",
            runner: "local",
          },
          git: { gitCommit: null, gitBranch: null, gitDirty: true },
        }),
        results,
        analysis,
      },
      suite,
    )
    await expect(text).toMatchFileSnapshot("./__snapshots__/benchmark-report-rare.snap")
  })

  it("explains that nothing is attributed when no function declares how it is used end to end", async () => {
    const suite = richSuite()
    const results = {
      "end-to-end:baseline": group("end-to-end", () => 1, RICH),
      "end-to-end:with-package": group("end-to-end", () => 2, RICH),
    }
    const analysis = analyze({ suite, results, tiers: RICH })
    const text = renderReport(
      { metadata: metadata(suite, { tiers: RICH }), results, analysis },
      suite,
    )
    expect(text).toContain("## 3. What makes up one end-to-end operation")
    expect(text).toContain(
      "_No function declared how it is used in the end-to-end run (`inEndToEnd`), so there is nothing to attribute._",
    )
  })

  const relative = (baselineMs: number, withMs: number): string => {
    const suite = suiteWith()
    const results = {
      "end-to-end:baseline": group("end-to-end", () => baselineMs),
      "end-to-end:with-package": group("end-to-end", () => withMs),
      "fn:sum": group("function", () => 1),
      "fn:lookup": group("function", () => 1),
    }
    const analysis = analyze({ suite, results, tiers: TIERS })
    const text = renderReport({ metadata: metadata(suite), results, analysis }, suite)
    const line = text.split("\n").find((l) => l.startsWith("| Added latency, relative to baseline"))
    return (line ?? "").split("|")[2]?.trim() ?? ""
  }

  it.each([
    [1, 1.05, "5.0%"],
    [10, 11, "10%"],
    [1, 1.0999, "10.0%"],
    [1, 2, "100%"],
    [1, 11, "11× baseline"],
    [1, 10.9, "990%"],
    [0.001, 12, "12,000× baseline"],
  ])("shows a baseline of %s ms against %s ms as %s", (baseline, withPackage, shown) => {
    expect(relative(baseline, withPackage)).toBe(shown)
  })

  const priced = (withMs: number, cpuMs: number, baselineMs = 1): string[] => {
    const suite = suiteWith()
    const tiers = Object.fromEntries(
      TIERS.map((n) => [tierName(n), entry(n, withMs, { cpuMs: { medianMs: cpuMs } })]),
    )
    const results = {
      "end-to-end:baseline": group("end-to-end", () => baselineMs),
      "end-to-end:with-package": { area: "end-to-end", tiers },
      "fn:sum": group("function", () => 1),
      "fn:lookup": group("function", () => 1),
    }
    const analysis = analyze({ suite, results, tiers: TIERS })
    const text = renderReport({ metadata: metadata(suite), results, analysis }, suite)
    const line = text.split("\n").find((l) => l.startsWith("| 80 |")) ?? ""
    return line.split("|").map((cell) => cell.trim())
  }

  it("prints the price range smallest first when CPU time is far below wall time", () => {
    expect(priced(5, 0.001)[7]).toBe("$0 – $0.0083")
  })

  it("prints one price when both ends round to the same figure", () => {
    expect(priced(0, 0)[7]).toBe("$0")
  })

  it("shows an unattributed share as n/a when the whole operation took no time", () => {
    const suite = suiteWith()
    const results = {
      "end-to-end:baseline": group("end-to-end", () => 0),
      "end-to-end:with-package": group("end-to-end", () => 0),
      "fn:sum": group("function", () => 0),
      "fn:lookup": group("function", () => 0),
    }
    const analysis = analyze({ suite, results, tiers: TIERS })
    const text = renderReport({ metadata: metadata(suite), results, analysis }, suite)
    expect(text).toContain("| _unattributed_ |  |  | 0 | n/a |")
    expect(text).toContain("| `sum` | 2 | 0 | 0 | n/a |")
  })

  it("lists the function that takes most of the operation first", () => {
    const suite = suiteWith()
    const results = {
      "end-to-end:baseline": group("end-to-end", () => 1),
      "end-to-end:with-package": group("end-to-end", () => 10),
      "fn:sum": group("function", () => 0.1),
      "fn:lookup": group("function", () => 3),
    }
    const analysis = analyze({ suite, results, tiers: TIERS })
    const text = renderReport({ metadata: metadata(suite), results, analysis }, suite)
    const rows = text
      .split("\n")
      .filter((l) => l.startsWith("| `sum` | 2") || l.startsWith("| `lookup` | 1"))
    expect(rows.map((r) => r.split("|")[1]?.trim())).toEqual([
      "`lookup`",
      "`sum`",
      "`lookup`",
      "`sum`",
    ])
  })

  it("says the growth rate could not be determined when too few sizes were measured end to end", () => {
    const suite = suiteWith()
    const results = {
      "end-to-end:baseline": group("end-to-end", () => 1, [80]),
      "end-to-end:with-package": group("end-to-end", () => 2, [80]),
      "fn:sum": group("function", () => 1),
      "fn:lookup": group("function", () => 1),
    }
    const analysis = analyze({ suite, results, tiers: TIERS })
    const text = renderReport({ metadata: metadata(suite), results, analysis }, suite)
    expect(text).toContain("Overall, its growth rate could not be determined from this run.")
    expect(text).not.toContain("**How the total grows:**")
  })

  it("shows n/a when the baseline took no time", () => {
    expect(relative(0, 1)).toBe("n/a")
  })
})

describe("formatters at their boundaries", () => {
  it.each([
    [0.9999, "1.00e+3 µs"],
    [1, "1.00 ms"],
    [999.4, "999 ms"],
    [1000, "1.00 s"],
  ])("formatMs(%s)", (ms, shown) => {
    expect(formatMs(ms)).toBe(shown)
  })

  it.each([
    [1023, "1023 B"],
    [1024, "1.0 KiB"],
    [1024 * 1024 - 1, "1024.0 KiB"],
    [1024 * 1024, "1.0 MiB"],
    [-1024, "-1.0 KiB"],
    [-5, "-5 B"],
    [0, "0 B"],
  ])("formatBytes(%s)", (bytes, shown) => {
    expect(formatBytes(bytes)).toBe(shown)
  })
})
