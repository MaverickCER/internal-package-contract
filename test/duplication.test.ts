import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { duplication, DUPLICATION_MAX_PERCENTAGE } from "../checks/duplication.js"
import { makeContext, makeResult } from "./support.js"

let cwd: string

beforeEach(() => {
  cwd = mkdtempSync(path.join(tmpdir(), "ipc-duplication-test-"))
  vi.spyOn(process, "cwd").mockReturnValue(cwd)
})

afterEach(() => {
  vi.restoreAllMocks()
  rmSync(cwd, { recursive: true, force: true })
})

function writeReport(
  statistics: { total: { percentage: number } },
  duplicates: unknown[] = [],
): void {
  mkdirSync(path.join(cwd, "reports/jscpd"), { recursive: true })
  writeFileSync(
    path.join(cwd, "reports/jscpd/jscpd-report.json"),
    JSON.stringify({ statistics, duplicates }),
    "utf8",
  )
}

describe("duplication", () => {
  it("fails when jscpd terminated abnormally, naming jscpd (not a blank tool name) in the rationale", async () => {
    const result = await duplication.policy(makeContext(makeResult({ status: "timed_out" })))
    expect(result).toEqual({
      outcome: "fail",
      rationale: "jscpd did not run to completion (status: timed_out).",
    })
  })

  it("fails when jscpd produced no JSON report", async () => {
    const result = await duplication.policy(makeContext(makeResult()))
    expect(result).toEqual({
      outcome: "fail",
      rationale: "Duplication: jscpd did not produce its JSON report.",
    })
  })

  it("fails when the report has no total percentage", async () => {
    writeReport({ total: { percentage: Number.NaN } })
    const result = await duplication.policy(makeContext(makeResult()))
    expect(result).toEqual({
      outcome: "fail",
      rationale: "Duplication: jscpd produced no total percentage.",
    })
  })

  it("fails when the report has no statistics field at all", async () => {
    mkdirSync(path.join(cwd, "reports/jscpd"), { recursive: true })
    writeFileSync(
      path.join(cwd, "reports/jscpd/jscpd-report.json"),
      JSON.stringify({ duplicates: [] }),
      "utf8",
    )
    const result = await duplication.policy(makeContext(makeResult()))
    expect(result).toEqual({
      outcome: "fail",
      rationale: "Duplication: jscpd produced no total percentage.",
    })
  })

  it("fails when the percentage is a non-number", async () => {
    mkdirSync(path.join(cwd, "reports/jscpd"), { recursive: true })
    writeFileSync(
      path.join(cwd, "reports/jscpd/jscpd-report.json"),
      JSON.stringify({ statistics: { total: { percentage: "5" } }, duplicates: [] }),
      "utf8",
    )
    const result = await duplication.policy(makeContext(makeResult()))
    expect(result).toEqual({
      outcome: "fail",
      rationale: "Duplication: jscpd produced no total percentage.",
    })
  })

  it("fails when the percentage is a number but not finite (Infinity) -- via a raw report so it survives as an actual Infinity, not JSON.stringify's own Infinity->null coercion", async () => {
    mkdirSync(path.join(cwd, "reports/jscpd"), { recursive: true })
    // `1e999` overflows to `Infinity` once JSON.parse converts it to a double -- unlike
    // `JSON.stringify(Infinity)`, which the `writeReport` helper would silently turn into `null`.
    writeFileSync(
      path.join(cwd, "reports/jscpd/jscpd-report.json"),
      '{"statistics":{"total":{"percentage":1e999}},"duplicates":[]}',
      "utf8",
    )
    const result = await duplication.policy(makeContext(makeResult()))
    expect(result).toEqual({
      outcome: "fail",
      rationale: "Duplication: jscpd produced no total percentage.",
    })
  })

  it("fails when statistics is present but total is missing (the second optional-chain link)", async () => {
    mkdirSync(path.join(cwd, "reports/jscpd"), { recursive: true })
    writeFileSync(
      path.join(cwd, "reports/jscpd/jscpd-report.json"),
      JSON.stringify({ statistics: {}, duplicates: [] }),
      "utf8",
    )
    const result = await duplication.policy(makeContext(makeResult()))
    expect(result).toEqual({
      outcome: "fail",
      rationale: "Duplication: jscpd produced no total percentage.",
    })
  })

  it("treats a non-array duplicates field as zero duplicates, without throwing", async () => {
    mkdirSync(path.join(cwd, "reports/jscpd"), { recursive: true })
    writeFileSync(
      path.join(cwd, "reports/jscpd/jscpd-report.json"),
      JSON.stringify({ statistics: { total: { percentage: 0 } }, duplicates: "not an array" }),
      "utf8",
    )
    const result = await duplication.policy(makeContext(makeResult()))
    expect(result).toEqual({
      outcome: "pass",
      rationale: "Duplication: 0.00% of src/ within the 0.75% budget (0 block(s)).",
    })
  })

  it("passes within budget, with no detail line at all when there are no duplicates", async () => {
    writeReport({ total: { percentage: 0 } })
    const result = await duplication.policy(makeContext(makeResult()))
    expect(result).toEqual({
      outcome: "pass",
      rationale: "Duplication: 0.00% of src/ within the 0.75% budget (0 block(s)).",
    })
  })

  it("passes at exactly the budget boundary (<=, not <)", async () => {
    writeReport({ total: { percentage: DUPLICATION_MAX_PERCENTAGE } })
    const result = await duplication.policy(makeContext(makeResult()))
    expect(result.outcome).toBe("pass")
  })

  it("passes within budget, listing each duplicate block exactly", async () => {
    writeReport({ total: { percentage: 0.5 } }, [
      {
        lines: 5,
        tokens: 10,
        firstFile: { name: "a.ts", start: 1 },
        secondFile: { name: "b.ts", start: 2 },
      },
    ])
    const result = await duplication.policy(makeContext(makeResult()))
    expect(result).toEqual({
      outcome: "pass",
      rationale:
        "Duplication: 0.50% of src/ within the 0.75% budget (1 block(s)).\n- a.ts:1 <-> b.ts:2 (5 lines)",
    })
  })

  it(`fails when the percentage exceeds the ${String(DUPLICATION_MAX_PERCENTAGE)}% budget, with the exact heading, block, and footer`, async () => {
    writeReport({ total: { percentage: 5 } }, [
      {
        lines: 5,
        tokens: 10,
        firstFile: { name: "a.ts", start: 1 },
        secondFile: { name: "b.ts", start: 2 },
      },
    ])
    const result = await duplication.policy(makeContext(makeResult()))
    expect(result).toEqual({
      outcome: "fail",
      rationale: [
        "Duplication: 5.00% of src/ exceeds the 0.75% budget (1 block(s)):",
        "- a.ts:1 <-> b.ts:2 (5 lines)",
        "",
        "Refactor the accidental ones; wrap a deliberate, documented copy in `// jscpd:ignore-start` / `// jscpd:ignore-end`.",
      ].join("\n"),
    })
  })
})
