import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { architecture, ARCHITECTURE_CONFIG_CANDIDATES } from "../checks/architecture.js"
import { makeContext, makeJsonResult, makeResult } from "./support.js"

let cwd: string

beforeEach(() => {
  cwd = mkdtempSync(path.join(tmpdir(), "ipc-architecture-test-"))
  vi.spyOn(process, "cwd").mockReturnValue(cwd)
})

afterEach(() => {
  vi.restoreAllMocks()
  rmSync(cwd, { recursive: true, force: true })
})

describe("architecture", () => {
  it("wires run to depcruise <src> --config <resolved> --output-type json --no-progress, with JSON output declared", () => {
    const check = architecture()
    const run = check.run as string[]
    expect(run).toEqual([
      "depcruise",
      "src",
      "--config",
      run[3],
      "--output-type",
      "json",
      "--no-progress",
    ])
    expect(run[3]).toContain("dependency-cruiser.cjs")
    expect(check.output).toEqual({ format: "json" })
  })

  it("fails, naming the status, when dependency-cruiser terminated abnormally", async () => {
    const check = architecture()
    const result = await check.policy(makeContext(makeResult({ status: "timed_out" })))
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain("did not run to completion")
  })

  it("fails without throwing when result.output is entirely absent (not merely unsuccessful)", async () => {
    const check = architecture()
    const result = await check.policy(makeContext(makeResult()))
    expect(result).toEqual({
      outcome: "fail",
      rationale:
        "Architecture: dependency-cruiser output could not be parsed as JSON (does `src/` exist?).",
    })
  })

  it("fails, appending the printed output, when output could not be parsed as JSON", async () => {
    const check = architecture()
    const result = await check.policy(
      makeContext(
        makeResult({
          output: { format: "json", success: false, error: "bad" },
          stdout: "raw depcruise output",
        }),
      ),
    )
    expect(result).toEqual({
      outcome: "fail",
      rationale:
        "Architecture: dependency-cruiser output could not be parsed as JSON (does `src/` exist?).\nraw depcruise output",
    })
  })

  it("fails when the parsed JSON value is null", async () => {
    const result = await architecture().policy(makeContext(makeJsonResult(null)))
    expect(result).toEqual({
      outcome: "fail",
      rationale: "Architecture: dependency-cruiser produced invalid JSON.",
    })
  })

  it("fails when the parsed JSON value is a non-object primitive", async () => {
    const result = await architecture().policy(makeContext(makeJsonResult(42)))
    expect(result).toEqual({
      outcome: "fail",
      rationale: "Architecture: dependency-cruiser produced invalid JSON.",
    })
  })

  it("fails when the JSON has no summary field at all", async () => {
    const result = await architecture().policy(makeContext(makeJsonResult({})))
    expect(result).toEqual({
      outcome: "fail",
      rationale: "Architecture: dependency-cruiser produced invalid JSON.",
    })
  })

  it("fails when the JSON has no summary.violations array", async () => {
    const check = architecture()
    const result = await check.policy(makeContext(makeJsonResult({ summary: {} })))
    expect(result).toEqual({
      outcome: "fail",
      rationale: "Architecture: dependency-cruiser produced invalid JSON.",
    })
  })

  it("passes with 0 violations, noting the bundled config", async () => {
    const check = architecture()
    const result = await check.policy(
      makeContext(makeJsonResult({ summary: { violations: [], totalCruised: 12 } })),
    )
    expect(result.outcome).toBe("pass")
    expect(result.rationale).toBe(
      "Architecture: 0 violations across 12 module(s) (bundled baseline config).",
    )
  })

  it("recognizes every one of its own documented config-file candidates", async () => {
    expect(ARCHITECTURE_CONFIG_CANDIDATES).toEqual(
      expect.arrayContaining([".dependency-cruiser.cjs", ".dependency-cruiser.json"]),
    )
  })

  it("omits the bundled-baseline note when the consumer has its own config", async () => {
    writeFileSync(
      path.join(cwd, ARCHITECTURE_CONFIG_CANDIDATES[0] ?? ".dependency-cruiser.js"),
      "module.exports = {}",
    )
    const check = architecture()
    const result = await check.policy(
      makeContext(makeJsonResult({ summary: { violations: [], totalCruised: 3 } })),
    )
    expect(result.rationale).toBe("Architecture: 0 violations across 3 module(s).")
  })

  it("warns, listing each finding, on warn/info-only violations", async () => {
    const check = architecture()
    const result = await check.policy(
      makeContext(
        makeJsonResult({
          summary: {
            totalCruised: 5,
            violations: [
              { from: "a.ts", to: "b.ts", rule: { name: "no-orphans", severity: "warn" } },
            ],
          },
        }),
      ),
    )
    expect(result).toEqual({
      outcome: "warn",
      rationale: [
        "Architecture: 1 warn/info finding(s), 0 blocking, across 5 module(s) (bundled baseline config):",
        "- a.ts -> b.ts [no-orphans]",
      ].join("\n"),
    })
  })

  it("fails, listing only the error(s), with no 'Plus' suffix, when there are no accompanying warn/info findings", async () => {
    const check = architecture()
    const result = await check.policy(
      makeContext(
        makeJsonResult({
          summary: {
            totalCruised: 5,
            violations: [
              { from: "a.ts", to: "b.ts", rule: { name: "no-circular", severity: "error" } },
            ],
          },
        }),
      ),
    )
    expect(result).toEqual({
      outcome: "fail",
      rationale: [
        "Architecture: 1 error-severity violation(s) across 5 module(s) (bundled baseline config):",
        "- a.ts -> b.ts [no-circular]",
      ].join("\n"),
    })
  })

  it("fails, listing errors and summarizing extra warn/info, on error-severity violations", async () => {
    const check = architecture()
    const result = await check.policy(
      makeContext(
        makeJsonResult({
          summary: {
            totalCruised: 5,
            violations: [
              { from: "a.ts", to: "b.ts", rule: { name: "no-circular", severity: "error" } },
              { from: "c.ts", to: "d.ts", rule: { name: "no-orphans", severity: "warn" } },
            ],
          },
        }),
      ),
    )
    expect(result).toEqual({
      outcome: "fail",
      rationale: [
        "Architecture: 1 error-severity violation(s) across 5 module(s) (bundled baseline config):",
        "- a.ts -> b.ts [no-circular]",
        "Plus 1 warn/info finding(s).",
      ].join("\n"),
    })
  })

  it("renders unknown-rule for a violation with no rule name", async () => {
    const check = architecture()
    const result = await check.policy(
      makeContext(
        makeJsonResult({
          summary: {
            totalCruised: 1,
            violations: [{ from: "a.ts", to: "b.ts" }],
          },
        }),
      ),
    )
    expect(result.rationale).toContain("a.ts -> b.ts [unknown-rule]")
  })
})
