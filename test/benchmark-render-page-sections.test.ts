import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { buildPageModel, escapeHtml, renderHtml } from "../scripts/benchmark/render-page.mjs"

const copy = JSON.parse(
  readFileSync(path.resolve(import.meta.dirname, "../scripts/benchmark/page-copy.json"), "utf8"),
) as {
  purpose: {
    heading: string
    why: string[]
    shows: { heading: string; items: string[] }
    doesNotShow: { heading: string; items: string[] }
  }
  interpretation: { heading: string; items: string[] }
  groups: Record<string, string>
  badges: { derived: string; poorFit: string }
  packageCost: {
    heading: string
    intro: string
    formula: string
    noise: string
    withinNoise: string
    columns: Record<string, string>
  }
}

let dir: string
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "ipc-page-sections-"))
})
afterAll(() => rmSync(dir, { recursive: true, force: true }))

const m = (medianMs: number, n: number, extra: Record<string, unknown> = {}) => ({
  medianMs,
  inputs: { variable: n },
  ...extra,
})
const entry = (i: number, over: Record<string, unknown> = {}) => ({
  timestamp: `2026-01-0${String(i + 1)}T00:00:00.000Z`,
  gitCommit: `c0ffee${String(i)}`.padEnd(40, "0"),
  runner: "GitHub Actions",
  cpuModel: "EPYC 7763",
  versions: {},
  measurements: {
    "end-to-end:baseline": { n20: m(0.5, 20), n40: m(1, 40), n80: m(0.001, 80) },
    "end-to-end:with-package": { n20: m(0.75, 20), n40: m(1.5, 40), n80: m(0.01, 80) },
    "end-to-end:overhead": { n20: m(0.25, 20), n40: m(0.5, 40) },
    "fn:parse": { n20: m(1, 20, { stdDevMs: 0.1 }), n40: m(2, 40, { stdDevMs: 0.4 }) },
  },
  ...over,
})
const page = async (entries: unknown[], name = "h.json") => {
  const file = path.join(dir, name)
  writeFileSync(file, JSON.stringify({ historySchemaVersion: 2, entries }))
  const model = await buildPageModel({ histories: [`Runtime|${file}`], maxEntries: 50 })
  return { model, html: renderHtml({ ...model, generatedAt: "2026-03-01T00:00:00.000Z" }) }
}

describe("the purpose and interpretation sections", () => {
  it("state why the benchmarks exist, what they show and what they do not", async () => {
    const { html } = await page([entry(0)])
    for (const text of [
      copy.purpose.heading,
      ...copy.purpose.why,
      copy.purpose.shows.heading,
      ...copy.purpose.shows.items,
      copy.purpose.doesNotShow.heading,
      ...copy.purpose.doesNotShow.items,
      copy.interpretation.heading,
      ...copy.interpretation.items,
    ]) {
      expect(html, text).toContain(escapeHtml(text))
    }
  })
  it("no longer claims that overhead is trustworthy regardless of machine", async () => {
    const { html } = await page([entry(0)])
    expect(html).not.toContain("trustworthy regardless of machine")
    expect(html).not.toContain("not comparable machine-to-machine")
  })
  it("comes before the first chart", async () => {
    const { html } = await page([entry(0)])
    expect(html.indexOf(copy.purpose.heading)).toBeGreaterThan(0)
    expect(html.indexOf(copy.purpose.heading)).toBeLessThan(html.indexOf('class="category"'))
  })
})

describe("group definitions", () => {
  it("explains each kind of group on its own card", async () => {
    const { html } = await page([entry(0)])
    for (const kind of ["baseline", "with-package", "derived-overhead", "function"]) {
      expect(html, kind).toContain(escapeHtml(copy.groups[kind]!))
    }
  })
  it("says nothing for a group it does not recognise", async () => {
    const { html } = await page([
      entry(0, { measurements: { custom: { n20: m(1, 20), n40: m(2, 40) } } }),
    ])
    for (const text of Object.values(copy.groups)) expect(html).not.toContain(escapeHtml(text))
  })
})

describe("the derived overhead group", () => {
  it("is never given a complexity class, and is badged as derived", async () => {
    const { model, html } = await page([entry(0), entry(1)])
    const group = model.categories[0]!.groups.find((g) => g.group === "end-to-end:overhead")!
    expect(group.complexityClass).toBeNull()
    expect(group.reason).toBe("derived")
    expect(html).toContain(escapeHtml(copy.badges.derived))
  })
  it("leaves the measured groups classified", async () => {
    const { model } = await page([entry(0), entry(1)])
    const group = model.categories[0]!.groups.find((g) => g.group === "fn:parse")!
    expect(group.complexityClass).not.toBeNull()
  })
})

describe("the poor-fit badge", () => {
  it("lists the usual causes", async () => {
    const wobbly = (n: number, ms: number) => m(ms, n)
    const { html } = await page([
      entry(0, {
        measurements: {
          "fn:wobble": {
            a: wobbly(10, 1),
            b: wobbly(20, 50),
            c: wobbly(40, 2),
            d: wobbly(80, 60),
            e: wobbly(160, 1),
          },
        },
      }),
    ])
    expect(html).toContain(escapeHtml(copy.badges.poorFit))
  })
})

describe("what the package adds", () => {
  it("shows baseline, with-package and the difference side by side, with the formula", async () => {
    const { html } = await page([entry(0)])
    expect(html).toContain(escapeHtml(copy.packageCost.heading))
    expect(html).toContain(escapeHtml(copy.packageCost.intro))
    expect(html).toContain(escapeHtml(copy.packageCost.formula))
    expect(html).toContain(escapeHtml(copy.packageCost.noise))
    for (const label of Object.values(copy.packageCost.columns))
      expect(html).toContain(escapeHtml(label))
    // n20: 0.500 ms -> 0.750 ms, +0.250 ms, +50.0%
    expect(html).toContain(
      "<td>20</td><td>0.500 ms</td><td>0.750 ms</td><td>+0.250 ms</td><td>+50.0%</td>",
    )
    expect(html).toContain(
      "<td>40</td><td>1.00 ms</td><td>1.50 ms</td><td>+0.500 ms</td><td>+50.0%</td>",
    )
  })
  it("says 'within timer noise' instead of a percentage for a baseline below the floor", async () => {
    const { html } = await page([entry(0)])
    expect(html).toContain(
      `<td>80</td><td>0.001 ms</td><td>0.010 ms</td><td>+0.009 ms</td><td>${copy.packageCost.withinNoise}</td>`,
    )
  })
  it("shows a negative difference with a true minus sign", async () => {
    const e = entry(0, {
      measurements: {
        "end-to-end:baseline": { n20: m(1, 20) },
        "end-to-end:with-package": { n20: m(0.5, 20) },
      },
    })
    const { html } = await page([e])
    expect(html).toContain("<td>−0.500 ms</td><td>−50.0%</td>")
  })
  it("uses the latest run that has both groups, and names it", async () => {
    const older = entry(0)
    const newer = entry(1, { measurements: { "fn:parse": { n20: m(1, 20), n40: m(2, 40) } } })
    const { html } = await page([older, newer])
    expect(html).toContain("<td>20</td><td>0.500 ms</td>")
    expect(html).toContain("2026-01-01")
  })
  it("is absent when the suite has no baseline and with-package groups", async () => {
    const { html } = await page([
      entry(0, { measurements: { "fn:parse": { n20: m(1, 20), n40: m(2, 40) } } }),
    ])
    expect(html).not.toContain(escapeHtml(copy.packageCost.heading))
  })
})

describe("provenance", () => {
  it("says how many runs came from how many commits, and where they were measured", async () => {
    const { html } = await page([entry(0), entry(1), entry(2)])
    expect(html).toContain(
      "3 runs from 3 commits. Each run is one measurement of one commit, not a repeat. Measured on GitHub Actions, EPYC 7763 (3 runs).",
    )
  })
  it("carries the runner and processor on every run in the model", async () => {
    const { model } = await page([entry(0)])
    expect(model.categories[0]!.runs[0]).toMatchObject({
      runner: "GitHub Actions",
      cpuModel: "EPYC 7763",
    })
    const { model: bare } = await page(
      [entry(0, { runner: undefined, cpuModel: undefined })],
      "bare.json",
    )
    expect(bare.categories[0]!.runs[0]).toMatchObject({ runner: null, cpuModel: null })
  })
})

describe("noise in the data tables", () => {
  it("shows each median with its relative standard deviation when the run kept one", async () => {
    const { html } = await page([entry(0)])
    expect(html).toContain("1.00 ms ±10%")
    expect(html).toContain("2.00 ms ±20%")
  })
  it("shows the median alone when no spread was kept", async () => {
    const { html } = await page([entry(0)])
    expect(html).toContain("<td>0.500 ms</td>")
    expect(html).not.toContain("0.500 ms ±")
  })
})
