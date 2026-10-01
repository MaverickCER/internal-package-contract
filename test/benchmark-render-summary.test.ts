import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { renderSummary } from "../scripts/benchmark/render-summary.mjs"

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
