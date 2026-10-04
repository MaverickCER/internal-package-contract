import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import fsPromises from "node:fs/promises"
import { syncBuiltinESMExports } from "node:module"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  SKIPPED_TESTS_SCHEMA,
  deriveSkippedTestsId,
  skippedByFile,
  tests,
  VITEST_RESULTS_PATH,
} from "../checks/tests.js"
import { validateExceptionRegistry } from "../checks/exception-record.js"
import { COMPLETE_V2, makeContext, makeResult } from "./support.js"

let cwd: string

beforeEach(() => {
  cwd = mkdtempSync(path.join(tmpdir(), "ipc-tests-check-test-"))
  vi.spyOn(process, "cwd").mockReturnValue(cwd)
  // Newer repo-contract `test` presets read the results file by a cwd-relative path of their own,
  // which Node resolves against the real working directory (and `process.chdir` is unsupported in
  // worker threads, which Stryker's runner uses). Redirect exactly that read into the temp dir.
  const realReadFile = fsPromises.readFile.bind(fsPromises)
  vi.spyOn(fsPromises, "readFile").mockImplementation(((file: unknown, ...rest: unknown[]) =>
    realReadFile(
      (file === VITEST_RESULTS_PATH ? path.join(cwd, VITEST_RESULTS_PATH) : file) as string,
      ...(rest as []),
    )) as typeof fsPromises.readFile)
  syncBuiltinESMExports()
})

afterEach(() => {
  vi.restoreAllMocks()
  syncBuiltinESMExports()
  rmSync(cwd, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
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

describe("tests -- skipped tests are findings, not silence", () => {
  const file = (name: string, statuses: string[]) => ({
    name: path.join(cwd, name),
    assertionResults: statuses.map((status) => ({ status, fullName: `${name} ${status}` })),
  })
  const results = (testResults: unknown[], total = 10) => ({
    numFailedTests: 0,
    numFailedTestSuites: 0,
    numTotalTests: total,
    numTotalTestSuites: 3,
    testResults,
  })
  const run = () => tests().policy(makeContext(makeResult()))
  const writeSkipRegistry = (records: unknown[]) => {
    mkdirSync(path.join(cwd, ".repo-contract/exceptions"), { recursive: true })
    writeFileSync(
      path.join(cwd, ".repo-contract/exceptions/skipped-tests.json"),
      JSON.stringify({ exceptions: records }),
    )
  }
  const record = (name: string, over: Record<string, unknown> = {}) => ({
    id: deriveSkippedTestsId(name),
    version: 2,
    justification: "Installs its fixture in a separate CI job.",
    file: name,
    ...COMPLETE_V2,
    ...over,
  })

  it("fails a run in which no test ran at all", async () => {
    writeResults(results([], 0))
    const result = await run()
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain("ran 0 tests")
  })

  it("fails, naming each file and the id to record, when tests were skipped without a reason", async () => {
    writeResults(
      results([
        file("test/a.test.ts", ["passed", "pending", "skipped"]),
        file("test/b.test.ts", ["todo"]),
      ]),
    )
    const result = await run()
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain(
      "3 test(s) did not run in 2 file(s), and 2 file(s) have no complete record",
    )
    expect(result.rationale).toContain(
      "- test/a.test.ts: 2 skipped -- add skipped-test:test/a.test.ts to .repo-contract/exceptions/skipped-tests.json",
    )
    expect(result.rationale).toContain("- test/b.test.ts: 0 skipped, 1 todo")
  })

  it("passes, saying how many were skipped and why that is explained, when every file has a complete record", async () => {
    writeResults(results([file("test/a.test.ts", ["pending", "pending"])]))
    writeSkipRegistry([record("test/a.test.ts")])
    const result = await run()
    expect(result.outcome).toBe("pass")
    expect(result.rationale).toContain(
      "2 test(s) skipped in 1 file(s), each explained by a record in",
    )
  })

  it("fails a file whose record is incomplete or expired, and ignores a record for a file that no longer skips", async () => {
    writeResults(results([file("test/a.test.ts", ["pending"])]))
    writeSkipRegistry([record("test/a.test.ts", { constraint: "" }), record("test/old.test.ts")])
    expect((await run()).rationale).toContain(
      "skipped-test:test/a.test.ts is incomplete (missing: constraint)",
    )
    writeSkipRegistry([record("test/a.test.ts", { expires: "2020-01-01" })])
    expect((await run()).rationale).toContain("expires (2020-01-01 has passed)")
    writeSkipRegistry([record("test/a.test.ts"), record("test/old.test.ts")])
    expect((await run()).outcome).toBe("pass")
  })

  it("caps the list of unexplained files", async () => {
    writeResults(
      results(
        Array.from({ length: 22 }, (_, i) =>
          file(`test/f${String(i).padStart(2, "0")}.test.ts`, ["pending"]),
        ),
      ),
    )
    const result = await run()
    expect(result.rationale).toContain("...and 2 more.")
  })

  it("fails when the skipped-tests registry is malformed", async () => {
    writeResults(results([file("test/a.test.ts", ["pending"])]))
    writeSkipRegistry([{ id: "bad" }])
    const result = await run()
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain("skipped-tests.json failed to load")
  })

  it("does not look for a registry when nothing was skipped", async () => {
    writeResults(results([file("test/a.test.ts", ["passed"])]))
    expect((await run()).outcome).toBe("pass")
  })
})

describe("skippedByFile()", () => {
  it("groups pending, skipped and todo tests per repo-relative file, ignoring the rest", () => {
    const root = "/repo"
    const map = skippedByFile(
      {
        testResults: [
          {
            name: "/repo/test/a.test.ts",
            assertionResults: [{ status: "pending" }, { status: "passed" }, { status: "todo" }],
          },
          { name: "/repo/test/b.test.ts", assertionResults: [{ status: "failed" }] },
          { name: "/repo/test/c.test.ts" },
          {},
        ],
      },
      root,
    )
    expect([...map.entries()]).toEqual([["test/a.test.ts", { skipped: 1, todo: 1 }]])
    expect(skippedByFile({}, root).size).toBe(0)
  })
})

describe("SKIPPED_TESTS_SCHEMA", () => {
  const rec = (over: Record<string, unknown> = {}) => ({
    id: "skipped-test:test/a.test.ts",
    version: 1,
    justification: "j",
    file: "test/a.test.ts",
    ...over,
  })
  it("accepts a record whose id derives from its file, and rejects an empty file or a mismatched id", () => {
    expect(validateExceptionRegistry([rec()], SKIPPED_TESTS_SCHEMA).ok).toBe(true)
    const empty = validateExceptionRegistry([rec({ file: "" })], SKIPPED_TESTS_SCHEMA)
    expect(empty.ok).toBe(false)
    const mismatch = validateExceptionRegistry(
      [rec({ file: "test/b.test.ts" })],
      SKIPPED_TESTS_SCHEMA,
    )
    expect(mismatch.ok).toBe(false)
    if (!mismatch.ok) expect(mismatch.errors[0]).toContain("does not match the id derived")
  })
})
