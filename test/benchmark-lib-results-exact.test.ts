import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  collectEntries,
  latestHistoryEntry,
  primaryMedianMs,
  readJson,
  resultsToMeasurements,
  tryReadJson,
} from "../scripts/benchmark/lib/results.mjs"

let dir: string
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "ipc-lib-results-"))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe("primaryMedianMs", () => {
  it("prefers totalMs, then a durationMs object, and gives up on anything else", () => {
    expect(primaryMedianMs({ totalMs: { medianMs: 3 }, durationMs: { medianMs: 9 } })).toBe(3)
    expect(primaryMedianMs({ totalMs: { medianMs: 0 } })).toBe(0)
    expect(primaryMedianMs({ durationMs: { medianMs: 9 } })).toBe(9)
    expect(primaryMedianMs({ durationMs: { medianMs: 0 } })).toBe(0)
    expect(primaryMedianMs({ totalMs: {}, durationMs: { medianMs: 9 } })).toBe(9)
    expect(primaryMedianMs({ durationMs: {} })).toBeUndefined()
    expect(primaryMedianMs({ durationMs: 5 })).toBeUndefined()
    expect(primaryMedianMs({ durationMs: null })).toBeUndefined()
    expect(primaryMedianMs({ durationMs: "5" })).toBeUndefined()
    expect(primaryMedianMs({})).toBeUndefined()
    expect(primaryMedianMs(undefined)).toBeUndefined()
  })
})

describe("reading json", () => {
  it("tryReadJson returns the parsed file, and null for no path, a missing file or bad json", () => {
    const good = path.join(dir, "good.json")
    writeFileSync(good, '{"a":"é"}', "utf8")
    expect(tryReadJson(good)).toEqual({ a: "é" })
    expect(tryReadJson(undefined)).toBeNull()
    expect(tryReadJson("")).toBeNull()
    expect(tryReadJson(path.join(dir, "missing.json"))).toBeNull()
    const bad = path.join(dir, "bad.json")
    writeFileSync(bad, "{nope", "utf8")
    expect(tryReadJson(bad)).toBeNull()
  })

  it("readJson parses, and throws for a missing file or bad json", () => {
    const good = path.join(dir, "good.json")
    writeFileSync(good, '{"a":"é"}', "utf8")
    expect(readJson(good)).toEqual({ a: "é" })
    expect(() => readJson(path.join(dir, "missing.json"))).toThrow()
    const bad = path.join(dir, "bad.json")
    writeFileSync(bad, "{nope", "utf8")
    expect(() => readJson(bad)).toThrow()
  })
})

describe("collectEntries and resultsToMeasurements", () => {
  it("flattens every tier of every benchmark, tolerating no results or no tiers", () => {
    expect(collectEntries(undefined)).toEqual([])
    expect(collectEntries({})).toEqual([])
    expect(collectEntries({ results: { a: {} } })).toEqual([])
    expect(
      collectEntries({ results: { a: { tiers: { t: { x: 1 } } }, b: { tiers: { u: 2, v: 3 } } } }),
    ).toEqual([
      { name: "a", tier: "t", entry: { x: 1 } },
      { name: "b", tier: "u", entry: 2 },
      { name: "b", tier: "v", entry: 3 },
    ])
  })

  it("keeps completed tiers that have a median, carrying object inputs through and nothing else", () => {
    expect(
      resultsToMeasurements({
        results: {
          g: {
            tiers: {
              ok: { status: "completed", durationMs: { medianMs: 1 }, inputs: { n: 5 } },
              noInputs: { status: "completed", durationMs: { medianMs: 2 } },
              emptyInputs: { status: "completed", durationMs: { medianMs: 3 }, inputs: {} },
              nullInputs: { status: "completed", durationMs: { medianMs: 4 }, inputs: null },
              stringInputs: { status: "completed", durationMs: { medianMs: 5 }, inputs: "n" },
              failed: { status: "failed", durationMs: { medianMs: 6 } },
              noMedian: { status: "completed" },
              total: { status: "completed", totalMs: { medianMs: 0 } },
            },
          },
          empty: { tiers: { failed: { status: "failed" } } },
        },
      }),
    ).toEqual({
      g: {
        ok: { medianMs: 1, inputs: { n: 5 } },
        noInputs: { medianMs: 2 },
        emptyInputs: { medianMs: 3, inputs: {} },
        nullInputs: { medianMs: 4 },
        stringInputs: { medianMs: 5 },
        total: { medianMs: 0 },
      },
    })
  })
})

describe("latestHistoryEntry", () => {
  it("is the last entry, or undefined when there is none to be had", () => {
    expect(latestHistoryEntry({ entries: [{ a: 1 }, { b: 2 }] })).toEqual({ b: 2 })
    expect(latestHistoryEntry({ entries: [] })).toBeUndefined()
    expect(latestHistoryEntry({ entries: "abc" })).toBeUndefined()
    expect(latestHistoryEntry({ entries: { 0: 1 } })).toBeUndefined()
    expect(latestHistoryEntry({})).toBeUndefined()
    expect(latestHistoryEntry(null)).toBeUndefined()
    expect(latestHistoryEntry(undefined)).toBeUndefined()
  })
})
