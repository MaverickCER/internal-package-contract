import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  buildPageModel,
  describeGroup,
  escapeHtml,
  formatMs,
  parseArgs,
  renderChartSvg,
  renderDataTable,
  renderHtml,
  run,
} from "../scripts/benchmark/render-page.mjs"

let dir: string
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "ipc-render-page-exact-"))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

function writeHistory(name: string, entries: unknown[]): string {
  const file = path.join(dir, name)
  writeFileSync(file, JSON.stringify({ historySchemaVersion: 2, entries }), "utf8")
  return file
}

const m = (ms: number, n: number) => ({ medianMs: ms, inputs: { n } })

/** A history that exercises gaps, partial tiers, versions, commits, pull requests and all badge kinds. */
const HISTORY = [
  {
    timestamp: "2026-01-01T00:00:00.000Z",
    gitCommit: "abcdef1234567890",
    pullRequest: 12,
    versions: { benchmarkSuiteVersion: 1, demo: "0.5.3" },
    measurements: {
      "fn:linear": { baseline: m(1, 10), stress: m(10, 100), extreme: m(100, 1000) },
      "fn:flat": { baseline: m(5, 10), stress: m(5, 100) },
      "fn:step": { baseline: m(1, 10), stress: m(1, 100), extreme: m(50, 1000) },
      "fn:single": { baseline: m(0.0004, 10) },
      "fn:gappy": { baseline: m(2, 10), stress: m(20, 100), custom: m(3, 10) },
    },
  },
  {
    timestamp: "2026-02-01T00:00:00.000Z",
    gitCommit: "1234567abcdef",
    versions: { benchmarkSuiteVersion: 1 },
    measurements: {
      "fn:linear": { baseline: m(1.2, 10), stress: m(12, 100), extreme: m(120, 1000) },
      "fn:flat": { baseline: m(5, 10), stress: m(5, 100) },
      "fn:step": { baseline: m(1, 10), stress: m(1, 100), extreme: m(50, 1000) },
      "fn:single": { baseline: m(0.5, 10) },
      "fn:gappy": { baseline: m(2, 10), custom: m(3.5, 10) },
    },
  },
  {
    measurements: {
      "fn:linear": { baseline: m(150, 10), stress: m(1500, 100), extreme: m(15000, 1000) },
      "fn:gappy": { baseline: m(2, 10), stress: m(21, 100), custom: m(4, 10) },
    },
  },
]

describe("render-page -- exact output", () => {
  it("renders the whole page for a rich history, with a repository to link", async () => {
    const file = writeHistory("rich.json", HISTORY)
    const model = await buildPageModel({
      histories: [`Runtime|${file}`, `Build-time|${file}`],
      maxEntries: 200,
      readme: "https://example.test/benchmarks/README.md?a=1&b=2",
      repo: "https://github.com/o/r",
    })
    await expect(
      renderHtml({ ...model, generatedAt: "2026-03-01T00:00:00.000Z" }),
    ).toMatchFileSnapshot("./__snapshots__/render-page-rich.snap")
  })

  it("renders a page without a readme link or repository, windowed to the latest entries", async () => {
    const file = writeHistory("rich.json", HISTORY)
    const model = await buildPageModel({ histories: [`Runtime|${file}`], maxEntries: 2 })
    expect(model.categories[0]).toMatchObject({ entryCount: 2, totalEntryCount: 3 })
    await expect(
      renderHtml({ ...model, generatedAt: "2026-03-01T00:00:00.000Z" }),
    ).toMatchFileSnapshot("./__snapshots__/render-page-windowed.snap")
  })

  it("renders a category with no data at all", async () => {
    const file = writeHistory("empty.json", [])
    const model = await buildPageModel({ histories: [`Empty|${file}`], maxEntries: 5 })
    await expect(
      renderHtml({ ...model, generatedAt: "2026-03-01T00:00:00.000Z" }),
    ).toMatchFileSnapshot("./__snapshots__/render-page-empty.snap")
  })

  it("tolerates a history whose entries are not an array", async () => {
    const file = path.join(dir, "odd.json")
    writeFileSync(file, JSON.stringify({ entries: "nope" }), "utf8")
    const model = await buildPageModel({ histories: [`Odd|${file}`], maxEntries: 5 })
    expect(model.categories[0]).toMatchObject({ entryCount: 0, totalEntryCount: 0, groups: [] })
  })

  it("orders tiers: the preferred ones first, then the rest alphabetically", async () => {
    const file = writeHistory("tiers.json", [
      {
        measurements: {
          g: { zeta: m(1, 1), alpha: m(1, 2), extreme: m(1, 3), fixed: m(1, 4), baseline: m(1, 5) },
        },
      },
    ])
    const model = await buildPageModel({ histories: [`T|${file}`], maxEntries: 5 })
    expect(model.categories[0]?.tierOrder).toEqual([
      "baseline",
      "extreme",
      "fixed",
      "alpha",
      "zeta",
    ])
  })

  it("sorts the groups by name", async () => {
    const file = writeHistory("groups.json", [
      {
        measurements: {
          b: { baseline: m(1, 1) },
          a: { baseline: m(1, 1) },
          c: { baseline: m(1, 1) },
        },
      },
    ])
    const model = await buildPageModel({ histories: [`G|${file}`], maxEntries: 5 })
    expect(model.categories[0]?.groups.map((g) => g.group)).toEqual(["a", "b", "c"])
  })

  it("classifies a group from its latest run that measured it", async () => {
    const file = writeHistory("latest.json", [
      { measurements: { g: { baseline: m(1, 10), stress: m(1000, 100) } } },
      { measurements: { other: { baseline: m(1, 10) } } },
    ])
    const model = await buildPageModel({ histories: [`L|${file}`], maxEntries: 5 })
    expect(model.categories[0]?.groups.find((g) => g.group === "g")?.complexityClass).not.toBeNull()
  })

  it("records each run's timestamp, or null, and tolerates entries with no measurements at all", async () => {
    const file = writeHistory("sparse.json", [
      { measurements: { g: { baseline: m(1, 10), stress: m(10, 100) } } },
      { timestamp: "2026-01-01T00:00:00.000Z" },
    ])
    const model = await buildPageModel({ histories: [`S|${file}`], maxEntries: 5 })
    expect(model.categories[0]?.timestamps).toEqual([null, "2026-01-01T00:00:00.000Z"])
    expect(model.categories[0]?.groups[0]?.series[0]?.points).toEqual([
      { index: 0, medianMs: 1 },
      null,
    ])
  })

  it("takes the first recorded version that is not the suite's own, and only a string", async () => {
    const file = writeHistory("versions.json", [
      {
        versions: { benchmarkSuiteVersion: "9", demo: "1.0.0" },
        measurements: { g: { baseline: m(1, 1) } },
      },
      { versions: { benchmarkSuiteVersion: "9" }, measurements: { g: { baseline: m(1, 1) } } },
      { versions: { demo: 5, other: "2.0.0" }, measurements: { g: { baseline: m(1, 1) } } },
      { measurements: { g: { baseline: m(1, 1) } } },
    ])
    const model = await buildPageModel({ histories: [`V|${file}`], maxEntries: 9 })
    expect(model.categories[0]?.runs.map((r) => r.version)).toEqual(["1.0.0", null, "2.0.0", null])
  })

  it("keeps only whole-number pull requests and string commits", async () => {
    const file = writeHistory("refs.json", [
      { gitCommit: 5, pullRequest: 1.5, measurements: { g: { baseline: m(1, 1) } } },
      { gitCommit: "abc", pullRequest: 3, measurements: { g: { baseline: m(1, 1) } } },
    ])
    const model = await buildPageModel({ histories: [`R|${file}`], maxEntries: 9 })
    expect(model.categories[0]?.runs.map((r) => [r.commit, r.pullRequest])).toEqual([
      [null, null],
      ["abc", 3],
    ])
  })

  it("rejects a history spec without a label or a path", async () => {
    await expect(buildPageModel({ histories: ["only-label"], maxEntries: 5 })).rejects.toThrow(
      '--history must be "label|path/to/history.json"; got: only-label',
    )
    await expect(buildPageModel({ histories: ["|path.json"], maxEntries: 5 })).rejects.toThrow(
      "--history must be",
    )
    await expect(buildPageModel({ histories: ["label|"], maxEntries: 5 })).rejects.toThrow(
      "--history must be",
    )
  })
})

describe("render-page -- pieces", () => {
  it("escapes the five characters that matter in HTML", () => {
    expect(escapeHtml(`<a href="x">&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;'&lt;/a&gt;")
  })

  it.each([
    [0.0005, "0.50 µs"],
    [0.001, "0.001 ms"],
    [0.9994, "0.999 ms"],
    [1, "1.00 ms"],
    [99.994, "99.99 ms"],
    [100, "100.0 ms"],
  ])("formatMs(%s)", (ms, shown) => {
    expect(formatMs(ms)).toBe(shown)
  })

  const group = (points: Array<{ index: number; medianMs: number } | null>) => ({
    group: "g",
    complexityClass: null,
    series: [{ tier: "baseline", points }],
  })

  it("describes a chart in words, with the span of runs and the inferred class", () => {
    const runs = [
      { timestamp: "2026-01-01T00:00:00.000Z", commit: null, pullRequest: null, version: "1.0.0" },
      { timestamp: null, commit: null, pullRequest: null, version: null },
    ]
    const withClass = {
      ...group([
        { index: 0, medianMs: 1 },
        { index: 1, medianMs: 2 },
      ]),
      complexityClass: "linear",
    }
    expect(describeGroup(withClass, runs)).toBe(
      "baseline: 1.00 ms → 2.00 ms over 2 runs. From v1.0.0, 2026-01-01 to run 2, –. Inferred complexity linear.",
    )
    expect(describeGroup(group([{ index: 0, medianMs: 1 }]), runs)).toContain("over 1 run.")
    expect(describeGroup(group([null]), [])).toBe(". Inferred complexity unavailable.")
  })

  it("skips a series with no points when describing", () => {
    const g = {
      group: "g",
      complexityClass: null,
      series: [
        { tier: "none", points: [null] },
        { tier: "some", points: [{ index: 0, medianMs: 3 }] },
      ],
    }
    expect(describeGroup(g, [])).toBe(
      "some: 3.00 ms → 3.00 ms over 1 run. Inferred complexity unavailable.",
    )
  })

  it("draws nothing for a group with no points", () => {
    expect(renderChartSvg(group([null]), ["baseline"], { baseline: 0 }, [], "id")).toBe("")
  })

  it("centres a single run and labels the axis for an unlabelled history", () => {
    const svg = renderChartSvg(
      group([{ index: 0, medianMs: 4 }]),
      ["baseline"],
      { baseline: 0 },
      [],
      "x",
    )
    expect(svg).toContain(">first run</text>")
    expect(svg).toContain('text-anchor="end">latest run</text>')
    expect(svg).toContain('cx="142.0"')
  })

  it("breaks a line at a gap and keeps the series colour slot", () => {
    const svg = renderChartSvg(
      group([
        { index: 0, medianMs: 1 },
        null,
        { index: 2, medianMs: 3 },
        { index: 3, medianMs: 4 },
      ]),
      ["baseline"],
      { baseline: 2 },
      [],
      "x",
    )
    expect(svg.match(/<path class="series-line s3"/g)).toHaveLength(2)
    expect(svg).toContain('stroke-dasharray="2 3"')
  })

  it("nudges direct labels apart when two lines end close together", () => {
    const g = {
      group: "g",
      complexityClass: null,
      series: [
        { tier: "a", points: [{ index: 0, medianMs: 10 }] },
        { tier: "b", points: [{ index: 0, medianMs: 10.01 }] },
      ],
    }
    const svg = renderChartSvg(g, ["a", "b"], { a: 0, b: 1 }, [], "x")
    const ys = [...svg.matchAll(/class="series-label" x="[\d.]+" y="([\d.]+)"/g)].map((x) =>
      Number(x[1]),
    )
    expect(ys[1]! - ys[0]!).toBeGreaterThanOrEqual(10)
  })

  it("shows a column only for tiers the group has, and a badge with or without a fit", () => {
    const g = group([{ index: 0, medianMs: 1 }])
    const table = renderDataTable(
      g,
      ["baseline", "ghost"],
      [{ timestamp: null, commit: null, pullRequest: null, version: null }],
      undefined,
    )
    expect(table).toContain("baseline (median)")
    expect(table).not.toContain("ghost")
    const page = (extra: object) =>
      renderHtml({
        generatedAt: "t",
        maxEntries: 5,
        categories: [
          {
            label: "L",
            tierOrder: ["baseline"],
            entryCount: 1,
            totalEntryCount: 1,
            timestamps: [null],
            runs: [{ timestamp: null, commit: null, pullRequest: null, version: null }],
            groups: [{ ...g, ...extra }],
          },
        ],
      })
    expect(page({ complexityClass: "linear", rSquared: 0.987 })).toContain(
      "Inferred complexity: linear (R² 0.99)",
    )
    expect(page({ complexityClass: "linear" })).toContain("Inferred complexity: linear</p>")
    expect(page({ reason: "no-size-variation" })).toContain(
      "unavailable (no size variation across tiers)",
    )
    expect(page({ reason: "poor-fit" })).toContain(
      "does not follow a power law across the largest sizes)",
    )
    expect(page({ reason: "insufficient-data" })).toContain(
      "fewer than 2 tiers with recorded inputs)",
    )
    expect(page({ series: [{ tier: "baseline", points: [null] }] })).toContain(
      '<p class="empty">No data</p></article>',
    )
    expect(page({})).toContain('<p class="class-badge unknown">')
    expect(page({ complexityClass: "linear" })).toContain('<p class="class-badge">')
  })

  it("links commits and pull requests only when a repository is given", () => {
    const runs = [
      {
        timestamp: "2026-01-01T00:00:00.000Z",
        commit: "abcdef1234",
        pullRequest: 7,
        version: "1.0.0",
      },
      { timestamp: null, commit: null, pullRequest: null, version: null },
    ]
    const g = group([{ index: 0, medianMs: 1 }, null])
    const linked = renderDataTable(g, ["baseline"], runs, "https://github.com/o/r")
    expect(linked).toContain('<a href="https://github.com/o/r/commit/abcdef1234">abcdef1</a>')
    expect(linked).toContain('<a href="https://github.com/o/r/pull/7">#7</a>')
    const plain = renderDataTable(g, ["baseline"], runs, undefined)
    expect(plain).not.toContain("<a ")
    expect(plain).toContain("<td>abcdef1</td>")
    expect(plain).toContain("<td>#7</td>")
    expect(plain).toContain("<td>–</td><td>–</td><td>–</td><td>–</td>")
  })
})

describe("render-page -- the command", () => {
  it("parses every flag and ignores unknown ones", () => {
    expect(
      parseArgs([
        "--out",
        "o.html",
        "--history",
        "A|a.json",
        "--history",
        "B|b.json",
        "--max-entries",
        "7",
        "--readme",
        "r",
        "--repo",
        "u",
        "--bogus",
      ]),
    ).toEqual({
      out: "o.html",
      histories: ["A|a.json", "B|b.json"],
      maxEntries: 7,
      readme: "r",
      repo: "u",
    })
    expect(parseArgs([])).toEqual({ histories: [], maxEntries: 200 })
    expect(parseArgs(["--help"]).help).toBe(true)
    expect(parseArgs(["-h"]).help).toBe(true)
  })

  const io = () => {
    const logs: string[] = []
    const errors: string[] = []
    return {
      logs,
      errors,
      io: { log: (t: string) => logs.push(t), error: (t: string) => errors.push(t) },
    }
  }

  it("prints usage and exits 0 for --help, 1 when something required is missing", async () => {
    const help = io()
    expect(await run(["--help"], help.io)).toBe(0)
    expect(help.errors[0]).toContain("Usage: node render-page.mjs --out")
    for (const argv of [[], ["--out", "x.html"], ["--history", "a|b"]]) {
      const missing = io()
      expect(await run(argv, missing.io)).toBe(1)
      expect(missing.errors).toHaveLength(1)
    }
  })

  it("writes the page, creating the folder, and says what it wrote", async () => {
    const history = writeHistory("h.json", HISTORY)
    const out = path.join(dir, "deep", "er", "index.html")
    const r = io()
    expect(await run(["--out", out, "--history", `Runtime|${history}`], r.io)).toBe(0)
    expect(r.logs).toEqual([`[render-page] wrote ${out} (1 categories)`])
    expect(readFileSync(out, "utf8")).toContain("<!doctype html>")
  })

  it.each(["0", "-3", "abc"])("falls back to 200 entries for --max-entries %s", async (value) => {
    const history = writeHistory("h.json", HISTORY)
    const out = path.join(dir, "i.html")
    expect(
      await run(["--out", out, "--history", `R|${history}`, "--max-entries", value], io().io),
    ).toBe(0)
    expect(readFileSync(out, "utf8")).toContain("(most recent 200 max)")
  })

  it("honours a positive --max-entries", async () => {
    const history = writeHistory("h.json", HISTORY)
    const out = path.join(dir, "i.html")
    await run(["--out", out, "--history", `R|${history}`, "--max-entries", "1"], io().io)
    expect(readFileSync(out, "utf8")).toContain("1 of 3 recorded run(s) shown (most recent 1 max)")
  })
})
