import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { parseArgs, run, summarize } from "../scripts/benchmark/render-summary.mjs"

let dir: string
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "ipc-render-summary-exact-"))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

function write(name: string, value: unknown): string {
  const file = path.join(dir, name)
  writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value), "utf8")
  return file
}

const done = (n: number, ms: number, extra: Record<string, unknown> = {}) => ({
  status: "completed",
  inputs: { n },
  durationMs: { medianMs: ms },
  ...extra,
})

const analysis = (overheadPercent: number, baselineMs: number, complexity: object = {}) => ({
  cost: { typical: { n: 640, baselineMs, overheadPercent } },
  complexity,
})

function results(over: Record<string, unknown> = {}) {
  return {
    metadata: {
      versions: { benchmarkSuiteVersion: 1 },
      environment: { nodeVersion: "v22.1.0", cpuModel: "CPU A" },
    },
    results: {
      "fn:alpha": { tiers: { baseline: done(10, 10), stress: done(100, 100) } },
      "fn:beta": { tiers: { baseline: done(10, 5), stress: done(100, 6) } },
      "end-to-end:overhead": {
        derived: true,
        tiers: { baseline: done(10, 1), stress: done(100, 2) },
      },
    },
    analysis: analysis(100, 2),
    ...over,
  }
}

const BUDGETS = `export const BUDGETS = { "fn:alpha": { maxRegressionPercent: 10 }, "*": { maxRegressionPercent: 30 } }
export const GATES = {}`

describe("summarize -- exact output", () => {
  it("a full comparison: shifts, gate failures, notes, a version mismatch, failed tiers and budget breaches", async () => {
    const previous = results({
      metadata: {
        versions: { benchmarkSuiteVersion: 0 },
        environment: { nodeVersion: "v20.0.0", cpuModel: "CPU B" },
      },
      results: {
        "fn:alpha": { tiers: { baseline: done(10, 5), stress: done(100, 50) } },
        "fn:beta": { tiers: { baseline: done(10, 5) } },
        "end-to-end:overhead": {
          derived: true,
          tiers: { baseline: done(10, 1), stress: done(100, 1) },
        },
      },
      analysis: analysis(100, 2),
    })
    const current = results({
      results: {
        "fn:alpha": { tiers: { baseline: done(10, 10), stress: done(100, 100) } },
        "fn:beta": {
          tiers: {
            baseline: done(10, 5),
            stress: { status: "failed", error: { name: "RangeError", message: "boom" } },
            extreme: { status: "skipped", reason: "too slow" },
            odd: { status: "failed" },
            gone: { status: "failed", reason: "x", error: { name: "E", message: "m" } },
          },
        },
        "fn:flat": { tiers: { baseline: { status: "completed", inputs: { n: 10 } } } },
        "fn:zero": {
          tiers: { baseline: done(10, 0), stress: done(100, 4) },
        },
        "end-to-end:overhead": {
          derived: true,
          tiers: { baseline: done(10, 1), stress: done(100, 9) },
        },
      },
      analysis: analysis(400, 2, {
        "fn:alpha": {
          agreement: "differs",
          expectedNotation: "O(n)",
          notation: "O(n²)",
          exponent: 2.04,
          rSquared: 0.99,
        },
        "fn:beta": { agreement: "differs", expected: "constant", class: "linear" },
        "fn:ok": { agreement: "matches" },
      }),
    })
    const release = results({ analysis: analysis(100, 2) })
    const history = {
      entries: [
        {
          measurements: {
            "fn:alpha": {
              baseline: { medianMs: 1, inputs: { n: 10 } },
              stress: { medianMs: 10, inputs: { n: 100 } },
              extreme: { medianMs: 100, inputs: { n: 1000 } },
            },
            "fn:untouched": { baseline: { medianMs: 1, inputs: { n: 10 } } },
          },
        },
        {
          measurements: {
            "fn:alpha": {
              baseline: { medianMs: 1, inputs: { n: 10 } },
              stress: { medianMs: 10, inputs: { n: 100 } },
              extreme: { medianMs: 100, inputs: { n: 1000 } },
            },
          },
        },
      ],
    }
    const { markdown, failures } = await summarize({
      marker: "<!-- m -->",
      budgetsPath: write("budgets.mjs", BUDGETS),
      examples: [
        `Runtime|${write("prev.json", previous)}|${write("cur.json", current)}|${write("hist.json", history)}|${write("rel.json", release)}`,
        `Second||${path.join(dir, "missing.json")}|`,
      ],
    })
    expect(failures.length).toBeGreaterThan(0)
    await expect(markdown).toMatchFileSnapshot("./__snapshots__/render-summary-full.snap")
  })

  it("change cells: faster, slower, unchanged, no previous, a failed previous, a zero previous, exactly at the budget", async () => {
    const previous = {
      metadata: { versions: { benchmarkSuiteVersion: 1 } },
      results: {
        "fn:faster": { tiers: { t: done(10, 20) } },
        "fn:same": { tiers: { t: done(10, 7) } },
        "fn:edge": { tiers: { t: done(10, 10) } },
        "fn:failedBefore": { tiers: { t: { status: "failed", durationMs: { medianMs: 1 } } } },
        "fn:zeroBefore": { tiers: { t: done(10, 0) } },
        "fn:noMedianNow": { tiers: { t: done(10, 5) } },
      },
    }
    const current = {
      metadata: { versions: { benchmarkSuiteVersion: 1 } },
      results: {
        "fn:faster": { tiers: { t: done(10, 10) } },
        "fn:same": { tiers: { t: done(10, 7) } },
        "fn:edge": { tiers: { t: done(10, 11) } },
        "fn:fresh": { tiers: { t: done(10, 3) } },
        "fn:failedBefore": { tiers: { t: done(10, 2) } },
        "fn:zeroBefore": { tiers: { t: done(10, 4) } },
        "fn:noMedianNow": { tiers: { t: { status: "completed", inputs: { n: 10 } } } },
      },
    }
    const { markdown } = await summarize({
      marker: "m",
      budgetsPath: write(
        "budgets.mjs",
        `export const BUDGETS = { "*": { maxRegressionPercent: 10 } }`,
      ),
      examples: [`R|${write("p.json", previous)}|${write("c.json", current)}|`],
    })
    const rows = Object.fromEntries(
      markdown
        .split("\n")
        .filter((l) => l.startsWith("| `fn:"))
        .map((l) => [l.split("`")[1], l]),
    )
    expect(rows["fn:faster"]).toBe("| `fn:faster` | t | 10.00ms | -50.0% | 10% |")
    expect(rows["fn:same"]).toBe("| `fn:same` | t | 7.00ms | +0.0% | 10% |")
    expect(rows["fn:edge"]).toBe("| `fn:edge` | t | 11.00ms | +10.0% | 10% |")
    expect(rows["fn:fresh"]).toBe("| `fn:fresh` | t | 3.00ms | — | 10% |")
    expect(rows["fn:failedBefore"]).toBe("| `fn:failedBefore` | t | 2.00ms | — | 10% |")
    expect(rows["fn:zeroBefore"]).toBe("| `fn:zeroBefore` | t | 4.00ms | — | 10% |")
    expect(rows["fn:noMedianNow"]).toBe("| `fn:noMedianNow` | t | — | — | 10% |")
    expect(markdown).not.toContain("Exceeds budget")
  })

  it("flags only growth strictly over the budget", async () => {
    const run = async (now: number) =>
      (
        await summarize({
          marker: "m",
          budgetsPath: write(
            "b.mjs",
            `export const BUDGETS = { "*": { maxRegressionPercent: 10 } }`,
          ),
          examples: [
            `R|${write("p.json", { results: { g: { tiers: { t: done(10, 10) } } } })}|${write("c.json", { results: { g: { tiers: { t: done(10, now) } } } })}|`,
          ],
        })
      ).markdown
    expect(await run(11)).not.toContain("Exceeds budget")
    expect(await run(11.1)).toContain("- ⚠️ `g.t` +11.0% (budget: 10%) — human review suggested.")
  })

  it("tells people about a complexity shift, quoting both classes, and keeps a blank line after one failure and one note", async () => {
    const lin = (n: number) => ({ medianMs: n, inputs: { n } })
    const history = write("h.json", {
      entries: [
        {
          measurements: {
            quad: {
              a: { medianMs: 1, inputs: { n: 10 } },
              b: { medianMs: 100, inputs: { n: 100 } },
              c: { medianMs: 10000, inputs: { n: 1000 } },
            },
          },
        },
        {
          measurements: {
            "fn:alpha": {
              a: { medianMs: 100, inputs: { n: 10 } },
              b: { medianMs: 10000, inputs: { n: 100 } },
            },
            other: { a: lin(1) },
          },
        },
      ],
    })
    const current = {
      metadata: { environment: { nodeVersion: "v22.0.0" } },
      results: {
        "fn:alpha": {
          tiers: {
            a: done(10, 10),
            b: done(100, 100),
            bogus: { status: "failed", inputs: { n: 1000 }, durationMs: { medianMs: 1e9 } },
            noMedian: { status: "completed", inputs: { n: 5000 } },
          },
        },
        noHistory: { tiers: { a: done(10, 1), b: done(100, 2) } },
        flat: { tiers: { a: done(10, 1), b: done(100, 1) } },
      },
      analysis: analysis(100, 10, { "fn:alpha": { agreement: "differs", exponent: 1 } }),
    }
    const previous = { metadata: { environment: { nodeVersion: "v20.0.0" } } }
    const { markdown } = await summarize({
      marker: "<!-- m -->",
      examples: [`R|${write("p.json", previous)}|${write("c.json", current)}|${history}`],
    })
    await expect(markdown).toMatchFileSnapshot("./__snapshots__/render-summary-shift.snap")
    expect(markdown).toContain("- 🔺 **R / `fn:alpha`**: `quadratic` → `linear`")
    expect(markdown).not.toContain("noHistory`**")
  })

  it("a clean run: gates passed, a first-ever run with nothing to compare", async () => {
    const { markdown, failures } = await summarize({
      marker: "<!-- m -->",
      examples: [`Runtime||${write("cur.json", results())}|`],
    })
    expect(failures).toEqual([])
    await expect(markdown).toMatchFileSnapshot("./__snapshots__/render-summary-clean.snap")
  })

  it("does not warn about a suite version when the previous run has no metadata (a first run's {})", async () => {
    const { markdown } = await summarize({
      marker: "m",
      examples: [`R|${write("prev.json", {})}|${write("cur.json", results())}|`],
    })
    expect(markdown).not.toContain("Suite version mismatch")
  })

  it("names both suite versions in the mismatch warning, tolerating missing version records", async () => {
    const withVersion = (v: unknown) => results({ metadata: { versions: v } })
    const prev = write("p.json", withVersion({ benchmarkSuiteVersion: 3 }))
    const cur = write("c.json", withVersion({ benchmarkSuiteVersion: 4 }))
    const out = (await summarize({ marker: "m", examples: [`R|${prev}|${cur}|`] })).markdown
    expect(out).toContain(
      "> ⚠️ **Suite version mismatch**: previous run used `s3`, current run used `s4`. Numbers below are not directly comparable.",
    )
    const noMetadata = write("nm.json", { results: results().results })
    const bare = (await summarize({ marker: "m", examples: [`R|${prev}|${noMetadata}|`] })).markdown
    expect(bare).toContain("previous run used `s3`, current run used `sundefined`")
    const noMeta2 = (
      await summarize({
        marker: "m",
        examples: [`R|${write("pm.json", { metadata: {} })}|${cur}|`],
      })
    ).markdown
    expect(noMeta2).toContain("previous run used `sundefined`, current run used `s4`")
    const noVersions = write("n.json", results({ metadata: {} }))
    const same = (await summarize({ marker: "m", examples: [`R|${noVersions}|${noVersions}|`] }))
      .markdown
    expect(same).not.toContain("mismatch")
    const mixed = (await summarize({ marker: "m", examples: [`R|${prev}|${noVersions}|`] }))
      .markdown
    expect(mixed).toContain("previous run used `s3`, current run used `sundefined`")
    const reverse = (await summarize({ marker: "m", examples: [`R|${noVersions}|${prev}|`] }))
      .markdown
    expect(reverse).toContain("previous run used `sundefined`, current run used `s3`")
  })

  it("says there are no complexity shifts when the history has no entries or none for a group", async () => {
    const cur = write("cur.json", results())
    for (const history of [{ entries: [] }, {}, "not json"]) {
      const out = (
        await summarize({ marker: "m", examples: [`R||${cur}|${write("h.json", history)}`] })
      ).markdown
      expect(out).not.toContain("Complexity shifts")
    }
    const out = (
      await summarize({
        marker: "m",
        examples: [`R||${cur}|${path.join(dir, "no-such-history.json")}`],
      })
    ).markdown
    expect(out).not.toContain("Complexity shifts")
  })

  it("tolerates a history whose latest entry recorded no measurements", async () => {
    const out = (
      await summarize({
        marker: "m",
        examples: [`R||${write("c.json", results())}|${write("h.json", { entries: [{}] })}`],
      })
    ).markdown
    expect(out).not.toContain("Complexity shifts")
  })

  it("rejects an example missing its label or its current results", async () => {
    await expect(summarize({ marker: "m", examples: ["|a|b|c"] })).rejects.toThrow(
      '--example must be "label|prevResultsPath|curResultsPath|historyPath[|releaseResultsPath]"',
    )
    await expect(summarize({ marker: "m", examples: ["label|a||c"] })).rejects.toThrow(
      "--example must be",
    )
  })

  it("reads budgets and gates from the budgets module, defaulting both when there is none", async () => {
    const cur = write("cur.json", results())
    const prev = write(
      "prev.json",
      results({
        results: { "fn:alpha": { tiers: { baseline: done(10, 5), stress: done(100, 50) } } },
      }),
    )
    const none = (await summarize({ marker: "m", examples: [`R|${prev}|${cur}|`] })).markdown
    expect(none).toContain("(unbudgeted)")
    const noExports = write("empty.mjs", "export const OTHER = 1")
    const empty = (
      await summarize({ marker: "m", budgetsPath: noExports, examples: [`R|${prev}|${cur}|`] })
    ).markdown
    expect(empty).toContain("(unbudgeted)")
    const off = write(
      "off.mjs",
      `export const GATES = { complexity: false }\nexport const BUDGETS = {}`,
    )
    const noGate = write(
      "gate.json",
      results({
        analysis: analysis(100, 2, { "fn:alpha": { agreement: "differs", exponent: 2 } }),
      }),
    )
    expect(
      (await summarize({ marker: "m", budgetsPath: off, examples: [`R||${noGate}|`] })).failures,
    ).toEqual([])
    expect((await summarize({ marker: "m", examples: [`R||${noGate}|`] })).failures.length).toBe(1)
  })
})

describe("render-summary -- the command", () => {
  it("parses every flag, defaulting the marker, and ignores unknown ones", () => {
    expect(parseArgs([])).toEqual({ examples: [], marker: "<!-- benchmark-summary -->" })
    expect(
      parseArgs([
        "--budgets",
        "b.mjs",
        "--marker",
        "M",
        "--example",
        "a",
        "--example",
        "b",
        "--gate",
        "--zzz",
      ]),
    ).toEqual({ budgetsPath: "b.mjs", marker: "M", examples: ["a", "b"], gate: true })
    expect(parseArgs(["--help"]).help).toBe(true)
    expect(parseArgs(["-h"]).help).toBe(true)
  })

  const io = () => {
    const out: string[] = []
    const err: string[] = []
    return { out, err, io: { out: (t: string) => out.push(t), error: (t: string) => err.push(t) } }
  }

  it("prints usage and exits 0 for --help, 1 when no example is given", async () => {
    const help = io()
    expect(await run(["--help"], help.io)).toBe(0)
    expect(help.err[0]).toContain("Usage: node render-summary.mjs --budgets")
    const none = io()
    expect(await run([], none.io)).toBe(1)
    expect(none.err).toHaveLength(1)
    expect(none.out).toEqual([])
  })

  it("writes the summary with a trailing newline, and fails a gated run only with --gate", async () => {
    const bad = write(
      "bad.json",
      results({
        analysis: analysis(100, 2, { "fn:alpha": { agreement: "differs", exponent: 2 } }),
      }),
    )
    const ungated = io()
    expect(await run(["--marker", "<!-- k -->", "--example", `R||${bad}|`], ungated.io)).toBe(0)
    expect(ungated.out[0]?.startsWith("<!-- k -->\n")).toBe(true)
    const direct = await summarize({ marker: "<!-- k -->", examples: [`R||${bad}|`] })
    expect(ungated.out[0]).toBe(direct.markdown + "\n")
    const gated = io()
    expect(await run(["--gate", "--example", `R||${bad}|`], gated.io)).toBe(1)
    const clean = write("clean.json", results())
    const passing = io()
    expect(await run(["--gate", "--example", `R||${clean}|`], passing.io)).toBe(0)
  })
})
