import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { tests, VITEST_RESULTS_PATH } from "../checks/tests.js"
import { makeContext, makeResult } from "./support.js"

let cwd: string

beforeEach(() => {
  cwd = mkdtempSync(path.join(tmpdir(), "ipc-tests-check-test-"))
  vi.spyOn(process, "cwd").mockReturnValue(cwd)
})

afterEach(() => {
  vi.restoreAllMocks()
  rmSync(cwd, { recursive: true, force: true })
})

function writeResults(value: unknown): void {
  mkdirSync(path.dirname(path.join(cwd, VITEST_RESULTS_PATH)), { recursive: true })
  writeFileSync(path.join(cwd, VITEST_RESULTS_PATH), JSON.stringify(value), "utf8")
}

describe("tests", () => {
  it("fails, naming Vitest specifically, when it terminated abnormally", async () => {
    const check = tests()
    const result = await check.policy(makeContext(makeResult({ status: "timed_out" })))
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain("Vitest did not run to completion")
  })

  it("fails with the exact stock message and no tail when Vitest did not produce its results file, with no output at all", async () => {
    const check = tests()
    const result = await check.policy(makeContext(makeResult()))
    expect(result).toEqual({
      outcome: "fail",
      rationale: `Tests: Vitest did not produce ${VITEST_RESULTS_PATH}.`,
    })
  })

  it("truncates a long Vitest output tail to exactly the last 3000 characters when the results file is missing", async () => {
    const check = tests()
    const longOutput = "a".repeat(3500) + "END"
    const result = await check.policy(makeContext(makeResult({ stdout: longOutput })))
    const tail = result.rationale.split("\n").at(-1) ?? ""
    expect(tail.length).toBe(3000)
    expect(tail.endsWith("END")).toBe(true)
  })

  it("fails when the results file is not valid JSON", async () => {
    mkdirSync(path.dirname(path.join(cwd, VITEST_RESULTS_PATH)), { recursive: true })
    writeFileSync(path.join(cwd, VITEST_RESULTS_PATH), "not json", "utf8")
    const check = tests()
    const result = await check.policy(makeContext(makeResult()))
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain(`did not produce ${VITEST_RESULTS_PATH}`)
  })

  it("delegates a clean run to the underlying test preset's pass verdict", async () => {
    writeResults({
      numFailedTests: 0,
      numFailedTestSuites: 0,
      numTotalTests: 42,
      numTotalTestSuites: 6,
      testResults: [],
    })
    const check = tests()
    const result = await check.policy(makeContext(makeResult()))
    expect(result).toEqual({
      outcome: "pass",
      rationale: "Vitest completed 42 test(s) with 0 failures across 6 suite(s).",
    })
  })

  it("delegates a failing run to the underlying test preset's fail verdict, listing failures", async () => {
    writeResults({
      numFailedTests: 1,
      numFailedTestSuites: 1,
      numTotalTests: 1,
      numTotalTestSuites: 1,
      testResults: [
        {
          name: "test/example.test.ts",
          assertionResults: [
            { status: "failed", fullName: "example works", failureMessages: ["expected true"] },
          ],
        },
      ],
    })
    const check = tests()
    const result = await check.policy(makeContext(makeResult()))
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain("example works")
    expect(result.rationale).toContain("expected true")
  })

  it("wires the run command to instrument coverage and write the JSON results file, exactly", () => {
    const check = tests()
    expect(check.run).toEqual([
      "vitest",
      "run",
      "--coverage",
      "--coverage.provider=v8",
      "--coverage.reporter=json-summary",
      "--coverage.reporter=json",
      "--coverage.reportsDirectory=coverage",
      "--reporter=json",
      `--outputFile=${VITEST_RESULTS_PATH}`,
    ])
  })
})
