import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { renderSummary, summarize } from "../scripts/benchmark/render-summary.mjs"

let dir: string

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "ipc-benchmark-render-summary-"))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function write(name: string, value: unknown): string {
  const file = path.join(dir, name)
  writeFileSync(file, JSON.stringify(value), "utf8")
  return file
}

function writeRaw(name: string, content: string): string {
  const file = path.join(dir, name)
  writeFileSync(file, content, "utf8")
  return file
}

function makeResults(overrides: Record<string, unknown> = {}) {
  return {
    metadata: { versions: { benchmarkSuiteVersion: 1 } },
    results: {
      "cold-start": {
        tiers: {
          baseline: { status: "completed", inputs: { n: 10 }, durationMs: { medianMs: 10 } },
          stress: { status: "completed", inputs: { n: 100 }, durationMs: { medianMs: 100 } },
        },
      },
    },
    ...overrides,
  }
}

describe("renderSummary", () => {
  it("renders a marker, heading, and per-example table even with no prior data (first-ever run)", async () => {
    const curPath = write("cur.json", makeResults())
    const budgetsPath = writeRaw(
      "budgets.mjs",
      'export const BUDGETS = { "cold-start": { maxRegressionPercent: 10 } }',
    )

    const output = await renderSummary({
      marker: "<!-- test-marker -->",
      budgetsPath,
      examples: [`Runtime|${""}|${curPath}|${""}`],
    })

    expect(output).toContain("<!-- test-marker -->")
    expect(output).toContain("# Benchmark summary")
    expect(output).toContain("## Runtime")
    expect(output).toContain("`cold-start`")
    expect(output).toContain("10.00ms")
    expect(output).not.toContain("Complexity shifts")
  })

  it("computes a percent change and flags a budget breach", async () => {
    const prevPath = write("prev.json", makeResults())
    const curPath = write(
      "cur.json",
      makeResults({
        results: {
          "cold-start": {
            tiers: {
              baseline: { status: "completed", inputs: { n: 10 }, durationMs: { medianMs: 20 } }, // +100%
              stress: { status: "completed", inputs: { n: 100 }, durationMs: { medianMs: 100 } },
            },
          },
        },
      }),
    )
    const budgetsPath = writeRaw(
      "budgets.mjs",
      'export const BUDGETS = { "cold-start": { maxRegressionPercent: 10 } }',
    )

    const output = await renderSummary({
      budgetsPath,
      examples: [`Runtime|${prevPath}|${curPath}|`],
    })

    expect(output).toContain("+100.0%")
    expect(output).toContain("Exceeds budget")
    expect(output).toContain("cold-start.baseline")
  })

  it('falls back to the "*" default budget for a group with no entry of its own', async () => {
    const prevPath = write("prev.json", makeResults())
    const curPath = write(
      "cur.json",
      makeResults({
        results: {
          "cold-start": {
            tiers: {
              baseline: { status: "completed", inputs: { n: 10 }, durationMs: { medianMs: 20 } },
              stress: { status: "completed", inputs: { n: 100 }, durationMs: { medianMs: 100 } },
            },
          },
        },
      }),
    )
    const budgetsPath = writeRaw(
      "budgets.mjs",
      'export const BUDGETS = { "*": { maxRegressionPercent: 10 } }',
    )
    const output = await renderSummary({
      budgetsPath,
      examples: [`Runtime|${prevPath}|${curPath}|`],
    })
    expect(output).toContain("Exceeds budget")
    expect(output).toContain("10%")
    expect(output).not.toContain("(unbudgeted)")
  })

  it("treats a first-run previous file (missing/unreadable) as no prior data, not a crash", async () => {
    const curPath = write("cur.json", makeResults())
    const output = await renderSummary({
      examples: [`Runtime|${path.join(dir, "does-not-exist.json")}|${curPath}|`],
    })
    expect(output).toContain("## Runtime")
    expect(output).not.toContain("undefined")
  })

  it("reports 'No current results found' when the current results file is unreadable", async () => {
    const output = await renderSummary({
      examples: [`Runtime||${path.join(dir, "missing.json")}|`],
    })
    expect(output).toContain("_No current results found._")
  })

  it("warns on a benchmark-suite-version mismatch between previous and current", async () => {
    const prevPath = write(
      "prev.json",
      makeResults({ metadata: { versions: { benchmarkSuiteVersion: 1 } } }),
    )
    const curPath = write(
      "cur.json",
      makeResults({ metadata: { versions: { benchmarkSuiteVersion: 2 } } }),
    )
    const output = await renderSummary({
      examples: [`Runtime|${prevPath}|${curPath}|`],
    })
    expect(output).toContain("Suite version mismatch")
  })

  it("leads with a complexity-shift section, ahead of the per-example tables, when the history shows a shifted class", async () => {
    const curPath = write(
      "cur.json",
      makeResults({
        results: {
          "cold-start": {
            tiers: {
              baseline: { status: "completed", inputs: { n: 10 }, durationMs: { medianMs: 1 } },
              stress: { status: "completed", inputs: { n: 100 }, durationMs: { medianMs: 100 } }, // quadratic-ish vs history's linear
            },
          },
        },
      }),
    )
    const historyPath = write("history.json", {
      historySchemaVersion: 2,
      entries: [
        {
          measurements: {
            "cold-start": {
              baseline: { medianMs: 1, inputs: { n: 10 } },
              stress: { medianMs: 10, inputs: { n: 100 } }, // linear vs previous
            },
          },
        },
      ],
    })

    const output = await renderSummary({
      examples: [`Runtime||${curPath}|${historyPath}`],
    })

    const complexityIdx = output.indexOf("Complexity shifts")
    const runtimeSectionIdx = output.indexOf("## Runtime")
    expect(complexityIdx).toBeGreaterThan(-1)
    expect(complexityIdx).toBeLessThan(runtimeSectionIdx)
    expect(output).toContain("cold-start")
    expect(output).toContain("`linear` → `quadratic`")
  })

  it("does not flag a complexity shift when no history path is given for an example", async () => {
    const curPath = write("cur.json", makeResults())
    const output = await renderSummary({
      examples: [`Runtime||${curPath}|`],
    })
    expect(output).not.toContain("Complexity shifts")
  })

  it("throws a clear error for a malformed --example spec", async () => {
    await expect(renderSummary({ examples: ["not-enough-fields"] })).rejects.toThrow(
      /label\|prevResultsPath/,
    )
  })
})

describe("summarize() -- gates", () => {
  const withAnalysis = (overheadPercent: number, complexity: object = {}) =>
    makeResults({
      metadata: {
        versions: { benchmarkSuiteVersion: 1 },
        environment: { nodeVersion: "v24.0.0", cpuModel: "EPYC 7763" },
      },
      analysis: {
        complexity,
        cost: { typical: { n: 640, baselineMs: 2, overheadPercent } },
      },
    })

  it("passes, and says so, when nothing differs and the overhead ratio holds", async () => {
    const prev = write("prev.json", withAnalysis(100))
    const cur = write("cur.json", withAnalysis(110))
    const { markdown, failures } = await summarize({
      marker: "<!-- m -->",
      examples: [`Runtime|${prev}|${cur}||`],
    })
    expect(failures).toEqual([])
    expect(markdown).toContain("## ✅ Gates passed")
    expect(markdown).not.toContain("Highlight-only")
  })

  it("fails a function whose measured class differs from the documented one", async () => {
    const cur = write(
      "cur.json",
      withAnalysis(100, {
        "fn:validator-includes": {
          agreement: "differs",
          expected: "linear",
          class: "constant",
          notation: "O(1)",
          expectedNotation: "O(n)",
          exponent: 0.07,
          rSquared: 0.9,
        },
      }),
    )
    const { markdown, failures } = await summarize({
      marker: "<!-- m -->",
      examples: [`Runtime||${cur}||`],
    })
    expect(failures).toHaveLength(1)
    expect(markdown).toContain("## ❌ 1 gate failed")
    expect(markdown).toContain(
      "❌ **Runtime** — `fn:validator-includes`: documented O(n), measured O(1)",
    )
  })

  it("fails normalized overhead growing past the allowance against the last release, even if the previous run is close", async () => {
    const prev = write("prev.json", withAnalysis(150))
    const release = write("release.json", withAnalysis(100))
    const cur = write("cur.json", withAnalysis(170))
    const { failures } = await summarize({
      marker: "<!-- m -->",
      examples: [`Runtime|${prev}|${cur}||${release}`],
    })
    expect(failures).toHaveLength(1)
    expect(failures[0]?.message).toContain("(last release)")
  })

  it("lets a package turn a gate off or relax it through a GATES export", async () => {
    const prev = write("prev.json", withAnalysis(100))
    const cur = write("cur.json", withAnalysis(300))
    const budgetsPath = writeRaw(
      "budgets.mjs",
      "export const BUDGETS = {}\nexport const GATES = { normalizedOverheadMaxIncreasePercent: { millisecondScale: 500 } }",
    )
    const { failures } = await summarize({
      marker: "<!-- m -->",
      budgetsPath,
      examples: [`Runtime|${prev}|${cur}||`],
    })
    expect(failures).toEqual([])
  })

  it("notes a different Node major between the runs", async () => {
    const prev = write("prev.json", {
      ...withAnalysis(100),
      metadata: { versions: { benchmarkSuiteVersion: 1 }, environment: { nodeVersion: "v22.0.0" } },
    })
    const cur = write("cur.json", withAnalysis(100))
    const { markdown } = await summarize({
      marker: "<!-- m -->",
      examples: [`Runtime|${prev}|${cur}||`],
    })
    expect(markdown).toContain("ℹ️ **Runtime** — The previous run used Node v22.0.0")
  })

  it("does not highlight the derived overhead group's raw delta, and says it is gated as a ratio", async () => {
    const derived = (ms: number) => ({
      ...makeResults(),
      results: {
        "end-to-end:overhead": {
          derived: true,
          tiers: {
            n640: { status: "completed", inputs: { n: 640 }, durationMs: { medianMs: ms } },
          },
        },
      },
    })
    const prev = write("prev.json", derived(1))
    const cur = write("cur.json", derived(10))
    const budgetsPath = writeRaw(
      "budgets.mjs",
      'export const BUDGETS = { "*": { maxRegressionPercent: 10 } }',
    )
    const { markdown } = await summarize({
      marker: "<!-- m -->",
      budgetsPath,
      examples: [`Runtime|${prev}|${cur}||`],
    })
    expect(markdown).toContain("(gated as a ratio)")
    expect(markdown).not.toContain("**Exceeds budget")
  })
})
