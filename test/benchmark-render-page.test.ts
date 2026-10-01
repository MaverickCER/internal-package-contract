import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { buildPageModel } from "../scripts/benchmark/render-page.mjs"

let dir: string
const scriptPath = path.resolve(import.meta.dirname, "../scripts/benchmark/render-page.mjs")

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "ipc-benchmark-render-page-"))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function writeHistory(name: string, entries: unknown[]): string {
  const file = path.join(dir, name)
  writeFileSync(file, JSON.stringify({ historySchemaVersion: 2, entries }), "utf8")
  return file
}

function entry(medianMs: { baseline: number; stress: number }) {
  return {
    timestamp: "2026-01-01T00:00:00.000Z",
    measurements: {
      "cold-start": {
        baseline: { medianMs: medianMs.baseline, inputs: { n: 10 } },
        stress: { medianMs: medianMs.stress, inputs: { n: 100 } },
      },
    },
  }
}

describe("link to the package's benchmarks guide", () => {
  const render = (extra: string[]): string => {
    const historyPath = writeHistory("runtime.json", [entry({ baseline: 1, stress: 10 })])
    const out = path.join(dir, "index.html")
    execFileSync(process.execPath, [
      scriptPath,
      "--out",
      out,
      "--history",
      `Runtime|${historyPath}`,
      ...extra,
    ])
    return readFileSync(out, "utf8")
  }
  it("links to the readme when one is given, escaping it", () => {
    const html = render([
      "--readme",
      'https://example.test/blob/main/benchmarks/README.md?a=1&b="2"',
    ])
    expect(html).toContain(
      '<a href="https://example.test/blob/main/benchmarks/README.md?a=1&amp;b=&quot;2&quot;">Read this package\'s benchmarks guide</a>',
    )
  })
  it("adds no link when no readme is given", () => {
    expect(render([])).not.toContain("benchmarks guide")
  })
  it("carries the readme url through the page model", async () => {
    const historyPath = writeHistory("runtime.json", [entry({ baseline: 1, stress: 10 })])
    const model = await buildPageModel({
      histories: [`Runtime|${historyPath}`],
      maxEntries: 200,
      readme: "https://x.test/README.md",
    })
    expect(model.readmeUrl).toBe("https://x.test/README.md")
  })
})

describe("buildPageModel", () => {
  it("builds an index-aligned series per tier, per group, across a bounded window", async () => {
    const historyPath = writeHistory("runtime.json", [
      entry({ baseline: 1, stress: 10 }),
      entry({ baseline: 1, stress: 20 }),
    ])

    const model = await buildPageModel({ histories: [`Runtime|${historyPath}`], maxEntries: 200 })

    expect(model.categories).toHaveLength(1)
    const category = model.categories[0]!
    expect(category.label).toBe("Runtime")
    expect(category.entryCount).toBe(2)
    expect(category.totalEntryCount).toBe(2)
    expect(category.tierOrder).toEqual(["baseline", "stress"])

    const group = category.groups.find((g) => g.group === "cold-start")!
    expect(group).toBeDefined()
    const stressSeries = group.series.find((s) => s.tier === "stress")!
    expect(stressSeries.points).toEqual([
      { index: 0, medianMs: 10 },
      { index: 1, medianMs: 20 },
    ])
  })

  it("bounds to the most recent N entries per history file", async () => {
    const entries = Array.from({ length: 250 }, (_, i) => entry({ baseline: 1, stress: i }))
    const historyPath = writeHistory("runtime.json", entries)

    const model = await buildPageModel({ histories: [`Runtime|${historyPath}`], maxEntries: 200 })
    const category = model.categories[0]!
    expect(category.entryCount).toBe(200)
    expect(category.totalEntryCount).toBe(250)

    // The last (bounded) window's first point should be entry index 50 (250-200), whose stress value is 50.
    const group = category.groups.find((g) => g.group === "cold-start")!
    const stressSeries = group.series.find((s) => s.tier === "stress")!
    expect(stressSeries.points[0]?.medianMs).toBe(50)
    expect(stressSeries.points.at(-1)?.medianMs).toBe(249)
  })

  it("annotates each group with its currently-inferred complexity class from the latest entry", async () => {
    // size ratio baseline(n=10) -> stress(n=100) is 10x; medianMs also grows
    // 10x (1 -> 10), which is exactly linear (exponent 1).
    const historyPath = writeHistory("runtime.json", [
      entry({ baseline: 1, stress: 10 }),
      entry({ baseline: 1, stress: 10 }), // still linear -- this is the "latest" one used for the badge
    ])
    const model = await buildPageModel({ histories: [`Runtime|${historyPath}`], maxEntries: 200 })
    const group = model.categories[0]!.groups.find((g) => g.group === "cold-start")!
    expect(group.complexityClass).toBe("linear")
  })

  it("reports null complexityClass with a reason when the latest entry can't be classified", async () => {
    const historyPath = writeHistory("runtime.json", [
      { timestamp: "t1", measurements: { "cold-start": { baseline: { medianMs: 1 } } } }, // only 1 usable tier, no inputs
    ])
    const model = await buildPageModel({ histories: [`Runtime|${historyPath}`], maxEntries: 200 })
    const group = model.categories[0]!.groups.find((g) => g.group === "cold-start")!
    expect(group.complexityClass).toBeNull()
    expect(group.reason).toBe("insufficient-data")
  })

  it("combines multiple history files (categories) into one model", async () => {
    const runtimePath = writeHistory("runtime.json", [entry({ baseline: 1, stress: 2 })])
    const buildtimePath = writeHistory("buildtime.json", [entry({ baseline: 3, stress: 4 })])
    const model = await buildPageModel({
      histories: [`Runtime|${runtimePath}`, `Build-time|${buildtimePath}`],
      maxEntries: 200,
    })
    expect(model.categories.map((c) => c.label)).toEqual(["Runtime", "Build-time"])
  })

  it("leaves gaps (null points) for a tier missing from a particular entry, rather than interpolating", async () => {
    const historyPath = writeHistory("runtime.json", [
      {
        timestamp: "t1",
        measurements: { "cold-start": { baseline: { medianMs: 1, inputs: { n: 10 } } } },
      },
      entry({ baseline: 1, stress: 2 }),
    ])
    const model = await buildPageModel({ histories: [`Runtime|${historyPath}`], maxEntries: 200 })
    const group = model.categories[0]!.groups.find((g) => g.group === "cold-start")!
    const stressSeries = group.series.find((s) => s.tier === "stress")!
    expect(stressSeries.points[0]).toBeNull()
    expect(stressSeries.points[1]).toEqual({ index: 1, medianMs: 2 })
  })
})

describe("render-page.mjs CLI", () => {
  it("writes a self-contained HTML file containing the required methodology text and complexity annotations", () => {
    const historyPath = writeHistory("runtime.json", [
      entry({ baseline: 1, stress: 2 }),
      entry({ baseline: 1, stress: 4 }), // shifts toward quadratic
    ])
    const outPath = path.join(dir, "docs", "benchmarks", "index.html")

    execFileSync(
      "node",
      [scriptPath, "--out", outPath, "--history", `Runtime|${historyPath}`, "--max-entries", "200"],
      { encoding: "utf8" },
    )

    const html = readFileSync(outPath, "utf8")
    expect(html).toContain("<!doctype html>")
    expect(html).toContain("What's measured")
    expect(html).toContain("not comparable machine-to-machine")
    expect(html).toContain("inferred complexity class")
    expect(html).toContain("cold-start")
    expect(html).toContain("Inferred complexity")
  })

  it("prints usage and exits non-zero when called without required arguments", () => {
    expect(() => execFileSync("node", [scriptPath], { encoding: "utf8" })).toThrow()
  })
})
