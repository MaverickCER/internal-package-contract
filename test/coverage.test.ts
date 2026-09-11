import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { COVERAGE_THRESHOLDS, coverage } from "../checks/coverage.js"
import { makeContext, makeResult } from "./support.js"

let cwd: string

beforeEach(() => {
  cwd = mkdtempSync(path.join(tmpdir(), "ipc-coverage-test-"))
  vi.spyOn(process, "cwd").mockReturnValue(cwd)
})

afterEach(() => {
  vi.restoreAllMocks()
  rmSync(cwd, { recursive: true, force: true })
})

function writeSummary(total: Record<string, { pct: number }>): void {
  mkdirSync(path.join(process.cwd(), "coverage"), { recursive: true })
  writeFileSync(
    path.join(process.cwd(), "coverage/coverage-summary.json"),
    JSON.stringify({ total }),
    "utf8",
  )
}

describe("coverage", () => {
  it("passes when every metric meets its threshold, exactly", async () => {
    writeSummary({
      lines: { pct: 95 },
      statements: { pct: 95 },
      functions: { pct: 100 },
      branches: { pct: 90 },
    })
    const result = await coverage.policy(makeContext(makeResult()))
    expect(result).toEqual({
      outcome: "pass",
      rationale:
        "Coverage thresholds met (lines 95%, statements 95%, functions 100%, branches 90%).",
    })
  })

  it("passes at exactly the threshold boundary (< fails; >= passes)", async () => {
    writeSummary({
      lines: { pct: COVERAGE_THRESHOLDS.lines },
      statements: { pct: 95 },
      functions: { pct: 100 },
      branches: { pct: 90 },
    })
    const result = await coverage.policy(makeContext(makeResult()))
    expect(result.outcome).toBe("pass")
  })

  it("fails, naming the shortfall, when a metric is below threshold", async () => {
    const shortfall = COVERAGE_THRESHOLDS.lines - 50
    writeSummary({
      lines: { pct: 50 },
      statements: { pct: 95 },
      functions: { pct: 100 },
      branches: { pct: 90 },
    })
    const result = await coverage.policy(makeContext(makeResult()))
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain(
      `lines: 50% < ${String(COVERAGE_THRESHOLDS.lines)}% required (${shortfall.toFixed(2)} points short)`,
    )
  })

  it("fails, listing every shortfall with the exact heading, when multiple metrics miss", async () => {
    writeSummary({
      lines: { pct: 50 },
      statements: { pct: 60 },
      functions: { pct: 100 },
      branches: { pct: 90 },
    })
    const result = await coverage.policy(makeContext(makeResult()))
    expect(result).toEqual({
      outcome: "fail",
      rationale: [
        "Coverage thresholds not met:",
        "- lines: 50% < 80% required (30.00 points short)",
        "- statements: 60% < 80% required (20.00 points short)",
      ].join("\n"),
    })
  })

  it("fails when a metric's percentage is missing or not a finite number", async () => {
    writeSummary({
      lines: { pct: Number.NaN },
      statements: { pct: 95 },
      functions: { pct: 100 },
      branches: { pct: 90 },
    })
    const result = await coverage.policy(makeContext(makeResult()))
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain("lines: percentage missing or invalid")
  })

  it("fails when a metric's percentage is a number but not finite (Infinity)", async () => {
    writeSummary({
      lines: { pct: Number.POSITIVE_INFINITY },
      statements: { pct: 95 },
      functions: { pct: 100 },
      branches: { pct: 90 },
    })
    const result = await coverage.policy(makeContext(makeResult()))
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain("lines: percentage missing or invalid")
  })

  it("fails when a metric is entirely absent from total (never throws)", async () => {
    mkdirSync(path.join(process.cwd(), "coverage"), { recursive: true })
    writeFileSync(
      path.join(process.cwd(), "coverage/coverage-summary.json"),
      JSON.stringify({
        total: { statements: { pct: 95 }, functions: { pct: 100 }, branches: { pct: 90 } },
      }),
      "utf8",
    )
    const result = await coverage.policy(makeContext(makeResult()))
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain("lines: percentage missing or invalid")
  })

  it("fails when coverage-summary.json has no total section", async () => {
    mkdirSync(path.join(process.cwd(), "coverage"), { recursive: true })
    writeFileSync(path.join(process.cwd(), "coverage/coverage-summary.json"), "{}", "utf8")
    const result = await coverage.policy(makeContext(makeResult()))
    expect(result).toEqual({
      outcome: "fail",
      rationale: "Coverage: coverage-summary.json has no `total` section.",
    })
  })

  it("fails when total is a non-object primitive", async () => {
    mkdirSync(path.join(process.cwd(), "coverage"), { recursive: true })
    writeFileSync(
      path.join(process.cwd(), "coverage/coverage-summary.json"),
      JSON.stringify({ total: "not an object" }),
      "utf8",
    )
    const result = await coverage.policy(makeContext(makeResult()))
    expect(result).toEqual({
      outcome: "fail",
      rationale: "Coverage: coverage-summary.json has no `total` section.",
    })
  })

  it("warns (does not fail) when Tests already failed and produced no summary", async () => {
    const result = await coverage.policy(
      makeContext(makeResult(), {
        evidence: {
          version: 1,
          startedAt: "",
          completedAt: "",
          durationMs: 0,
          checks: { Tests: makeResult({ exitCode: 1 }) },
        },
      }),
    )
    expect(result).toEqual({
      outcome: "warn",
      rationale: "Coverage: not evaluated -- the `Tests` run did not pass (see `Tests`).",
    })
  })

  it("fails (not warn) when Tests exited 0 but the summary is still missing", async () => {
    const result = await coverage.policy(
      makeContext(makeResult(), {
        evidence: {
          version: 1,
          startedAt: "",
          completedAt: "",
          durationMs: 0,
          checks: { Tests: makeResult({ exitCode: 0 }) },
        },
      }),
    )
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain("no coverage/coverage-summary.json")
  })

  it("fails when no summary exists and Tests is not known to have failed", async () => {
    const result = await coverage.policy(makeContext(makeResult()))
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain("no coverage/coverage-summary.json")
  })
})
