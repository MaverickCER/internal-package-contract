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
  type RawResultsJson,
} from "../scripts/benchmark/lib/results.mjs"

let dir: string

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "ipc-benchmark-results-"))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe("primaryMedianMs", () => {
  it("prefers totalMs.medianMs", () => {
    expect(primaryMedianMs({ totalMs: { medianMs: 1.5 } })).toBe(1.5)
  })

  it("falls back to durationMs.medianMs", () => {
    expect(primaryMedianMs({ durationMs: { medianMs: 2.5 } })).toBe(2.5)
  })

  it("returns undefined when neither field is present, without crashing", () => {
    expect(primaryMedianMs({})).toBeUndefined()
    expect(primaryMedianMs(undefined)).toBeUndefined()
    expect(primaryMedianMs({ durationMs: 5 })).toBeUndefined()
  })
})

describe("tryReadJson / readJson", () => {
  it("tryReadJson returns null for a missing file instead of throwing", () => {
    expect(tryReadJson(path.join(dir, "missing.json"))).toBeNull()
    expect(tryReadJson(undefined)).toBeNull()
  })

  it("tryReadJson returns null for unparseable JSON", () => {
    const file = path.join(dir, "bad.json")
    writeFileSync(file, "{ not json", "utf8")
    expect(tryReadJson(file)).toBeNull()
  })

  it("readJson parses a real file", () => {
    const file = path.join(dir, "good.json")
    writeFileSync(file, JSON.stringify({ a: 1 }), "utf8")
    expect(readJson(file)).toEqual({ a: 1 })
  })

  it("readJson throws for a missing file", () => {
    expect(() => readJson(path.join(dir, "missing.json"))).toThrow()
  })
})

const SAMPLE_RESULTS: RawResultsJson = {
  metadata: {
    timing: { finishedAtUtc: "2026-01-01T00:00:00.000Z" },
    git: { gitCommit: "abc123" },
    environment: { runner: "GitHub Actions" },
    versions: { benchmarkSuiteVersion: 1, dataCapVersion: "0.4.0" },
  },
  results: {
    "cold-start": {
      tiers: {
        baseline: {
          status: "completed",
          inputs: { capabilities: 10 },
          durationMs: { medianMs: 5 },
        },
        stress: {
          status: "completed",
          inputs: { capabilities: 100 },
          totalMs: { medianMs: 50 },
        },
        extreme: { status: "failed", reason: "timeout" },
      },
    },
  },
}

describe("collectEntries", () => {
  it("flattens every (name, tier, entry) regardless of status", () => {
    const entries = collectEntries(SAMPLE_RESULTS)
    expect(entries).toHaveLength(3)
    expect(entries.map((e) => `${e.name}.${e.tier}`).sort()).toEqual([
      "cold-start.baseline",
      "cold-start.extreme",
      "cold-start.stress",
    ])
  })

  it("returns an empty array for missing/malformed results", () => {
    expect(collectEntries(null)).toEqual([])
    expect(collectEntries(undefined)).toEqual([])
    expect(collectEntries({})).toEqual([])
  })
})

describe("resultsToMeasurements", () => {
  it("normalizes completed tiers into {group: {tier: {medianMs, inputs}}}, carrying inputs through", () => {
    const measurements = resultsToMeasurements(SAMPLE_RESULTS)
    expect(measurements).toEqual({
      "cold-start": {
        baseline: { medianMs: 5, inputs: { capabilities: 10 } },
        stress: { medianMs: 50, inputs: { capabilities: 100 } },
      },
    })
  })

  it("excludes non-completed tiers", () => {
    const measurements = resultsToMeasurements(SAMPLE_RESULTS)
    expect(measurements["cold-start"]).not.toHaveProperty("extreme")
  })

  it("omits inputs entirely when the raw entry has none, rather than writing an empty object", () => {
    const measurements = resultsToMeasurements({
      results: {
        thing: { tiers: { fixed: { status: "completed", durationMs: { medianMs: 1 } } } },
      },
    })
    expect(measurements["thing"]?.["fixed"]).toEqual({ medianMs: 1 })
    expect(measurements["thing"]?.["fixed"]).not.toHaveProperty("inputs")
  })
})

describe("latestHistoryEntry", () => {
  it("returns the last entry in an append-ordered history file", () => {
    const entry = latestHistoryEntry({
      entries: [{ timestamp: "t1" }, { timestamp: "t2" }, { timestamp: "t3" }],
    })
    expect(entry?.timestamp).toBe("t3")
  })

  it("returns undefined for an empty or missing history", () => {
    expect(latestHistoryEntry({ entries: [] })).toBeUndefined()
    expect(latestHistoryEntry(undefined)).toBeUndefined()
    expect(latestHistoryEntry({})).toBeUndefined()
  })
})
