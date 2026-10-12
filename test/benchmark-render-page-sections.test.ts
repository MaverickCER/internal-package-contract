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
  it("writes the header cells and the rows with nothing between them", async () => {
    const { html } = await page([entry(0)])
    expect(html).toContain('</th><th scope="col">')
    expect(html).not.toMatch(/<\/th>[^<]+<th/)
    expect(html).toContain("</td></tr><tr><td>40</td>")
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

describe("what the package adds: edge cases", () => {
  const both = (baseline: unknown, withPackage: unknown, over: Record<string, unknown> = {}) =>
    entry(0, {
      measurements: { "end-to-end:baseline": baseline, "end-to-end:with-package": withPackage },
      ...over,
    })
  it("takes the latest run that has both groups, not one that has only one of them", async () => {
    const both0 = entry(0)
    const onlyBaseline = entry(1, {
      measurements: { "end-to-end:baseline": { n20: m(9, 20) } },
    })
    const onlyPackage = entry(2, {
      measurements: { "end-to-end:with-package": { n20: m(9, 20) } },
    })
    const { html } = await page([both0, onlyBaseline, onlyPackage], "partial.json")
    expect(html).toContain("<td>20</td><td>0.500 ms</td><td>0.750 ms</td>")
    expect(html).toContain("2026-01-01")
  })
  it("gives a difference of nothing a plus sign, not a minus", async () => {
    const { html } = await page([both({ n20: m(1, 20) }, { n20: m(1, 20) })], "zero.json")
    expect(html).toContain("<td>+0.00 µs</td><td>+0.0%</td>")
  })
  it("shows a dash where a row has no input size, and keeps the tiers in the order given", async () => {
    const { html } = await page(
      [both({ n80: { medianMs: 1 }, n20: m(1, 20) }, { n80: { medianMs: 2 }, n20: m(2, 20) })],
      "nosize.json",
    )
    expect(html).toContain("<td>–</td><td>1.00 ms</td><td>2.00 ms</td>")
    expect(html.indexOf("<td>20</td><td>1.00 ms</td>")).toBeLessThan(
      html.indexOf("<td>–</td><td>1.00 ms</td>"),
    )
  })
  it("takes the size from the baseline when the with-package measurement did not record one", async () => {
    const { html } = await page(
      [both({ n20: m(1, 20) }, { n20: { medianMs: 2 } })],
      "base-size.json",
    )
    expect(html).toContain("<td>20</td><td>1.00 ms</td><td>2.00 ms</td>")
  })
  it("names the commit of the run it shows, and says nothing of a commit when there is none", async () => {
    const withCommit = await page([entry(0)], "commit.json")
    expect(withCommit.html).toContain("2026-01-01, commit c0ffee0</caption>")
    const noCommit = await page([entry(0, { gitCommit: undefined })], "nocommit.json")
    expect(noCommit.html).toContain("Latest run measuring both: 2026-01-01</caption>")
  })
  it("leaves no trace of the table, not even whitespace or text, when it is absent", async () => {
    const { html } = await page(
      [entry(0, { measurements: { "fn:parse": { n20: m(1, 20), n40: m(2, 40) } } })],
      "absent.json",
    )
    expect(html).toContain("Each chart's data is available as a table beneath it.</p><ul")
  })
})

describe("the group definition", () => {
  it("is given for a group the suite kit makes and left out for any other", async () => {
    const e = entry(0, {
      measurements: {
        "fn:parse": { n20: m(1, 20), n40: m(2, 40) },
        "custom-group": { n20: m(1, 20), n40: m(2, 40) },
      },
    })
    const { html } = await page([e], "kinds.json")
    expect(html).toContain(
      `<h3>fn:parse</h3><p class="kind">${escapeHtml(copy.groups["function"]!)}</p>`,
    )
    expect(html).toContain('<h3>custom-group</h3><p class="class-badge')
  })
})

describe("the median's noise", () => {
  it("is left out when the median is zero, rather than dividing by it", async () => {
    const e = entry(0, {
      measurements: { "fn:parse": { n20: m(0, 20, { stdDevMs: 1 }), n40: m(2, 40) } },
    })
    const { html } = await page([e], "zero-median.json")
    expect(html).toContain("<td>0.00 µs</td>")
    expect(html).not.toMatch(/Infinity|NaN/)
  })
})

describe("provenance", () => {
  it("mentions the processor not being recorded only when no run recorded one", async () => {
    const some = await page([entry(0, { cpuModel: undefined }), entry(1)], "some-cpu.json")
    expect(some.html).not.toContain("the processor was not recorded")
    const none = await page(
      [entry(0, { cpuModel: undefined }), entry(1, { cpuModel: undefined })],
      "no-cpu.json",
    )
    expect(none.html).toContain("the processor was not recorded")
  })
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
