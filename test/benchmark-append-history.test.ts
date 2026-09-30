import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

let dir: string
const scriptPath = path.resolve(import.meta.dirname, "../scripts/benchmark/append-history.mjs")

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "ipc-benchmark-append-history-"))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function writeResults(overrides: Record<string, unknown> = {}): string {
  const resultsPath = path.join(dir, "results.json")
  const results = {
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
            durationMs: { medianMs: 50 },
          },
        },
      },
    },
    ...overrides,
  }
  writeFileSync(resultsPath, JSON.stringify(results), "utf8")
  return resultsPath
}

function run(resultsPath: string, historyPath: string): void {
  execFileSync("node", [scriptPath, resultsPath, historyPath], { encoding: "utf8" })
}

describe("append-history.mjs", () => {
  it("creates a fresh schema-v2 history file when none exists", () => {
    const resultsPath = writeResults()
    const historyPath = path.join(dir, "history.json")
    run(resultsPath, historyPath)

    const history = JSON.parse(readFileSync(historyPath, "utf8"))
    expect(history.historySchemaVersion).toBe(2)
    expect(history.entries).toHaveLength(1)
    expect(history.entries[0]).toMatchObject({
      timestamp: "2026-01-01T00:00:00.000Z",
      gitCommit: "abc123",
      runner: "GitHub Actions",
      versions: { benchmarkSuiteVersion: 1, dataCapVersion: "0.4.0" },
    })
  })

  it("carries the full inputs object through per tier, not just a derived figure", () => {
    const resultsPath = writeResults()
    const historyPath = path.join(dir, "history.json")
    run(resultsPath, historyPath)

    const history = JSON.parse(readFileSync(historyPath, "utf8"))
    const measurement = history.entries[0].measurements["cold-start"].baseline
    expect(measurement.medianMs).toBe(5)
    expect(measurement.inputs).toEqual({ capabilities: 10 })
    // unitsPerSecond: inputTotal(10) / (5ms / 1000) = 10 / 0.005 = 2000
    expect(measurement.unitsPerSecond).toBeCloseTo(2000, 5)
  })

  it("appends to an existing v1-shaped history file without discarding old entries, and bumps the version marker", () => {
    const historyPath = path.join(dir, "history.json")
    writeFileSync(
      historyPath,
      JSON.stringify({
        historySchemaVersion: 1,
        entries: [
          {
            timestamp: "2025-01-01T00:00:00.000Z",
            gitCommit: null,
            envCapVersion: "0.1.0",
            benchmarkSuiteVersion: 1,
            runner: "local",
            measurements: { "cold-start": { baseline: { medianMs: 9 } } }, // no inputs -- real v1 shape
          },
        ],
      }),
      "utf8",
    )
    const resultsPath = writeResults()
    run(resultsPath, historyPath)

    const history = JSON.parse(readFileSync(historyPath, "utf8"))
    expect(history.historySchemaVersion).toBe(2)
    expect(history.entries).toHaveLength(2)
    // Old entry is untouched -- no forced backfill/migration.
    expect(history.entries[0]).toMatchObject({
      envCapVersion: "0.1.0",
      measurements: { "cold-start": { baseline: { medianMs: 9 } } },
    })
    expect(history.entries[0].measurements["cold-start"].baseline).not.toHaveProperty("inputs")
  })

  it("only writes measurements for completed tiers", () => {
    const resultsPath = writeResults({
      results: {
        thing: {
          tiers: {
            ok: { status: "completed", inputs: { n: 1 }, durationMs: { medianMs: 1 } },
            broken: { status: "failed", reason: "boom" },
          },
        },
      },
    })
    const historyPath = path.join(dir, "history.json")
    run(resultsPath, historyPath)

    const history = JSON.parse(readFileSync(historyPath, "utf8"))
    expect(Object.keys(history.entries[0].measurements.thing)).toEqual(["ok"])
  })

  it("prints usage and exits non-zero when called without both arguments", () => {
    expect(() => execFileSync("node", [scriptPath], { encoding: "utf8" })).toThrow()
  })
})
