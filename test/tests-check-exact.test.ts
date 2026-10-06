import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import fsPromises from "node:fs/promises"
import { syncBuiltinESMExports } from "node:module"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { validateExceptionRegistry } from "../checks/exception-record.js"
import {
  SKIPPED_TESTS_SCHEMA,
  VITEST_RESULTS_PATH,
  deriveSkippedTestsId,
  skippedByFile,
  tests,
} from "../checks/tests.js"
import { COMPLETE_V2, makeContext, makeResult } from "./support.js"

let cwd: string
beforeEach(() => {
  cwd = mkdtempSync(path.join(tmpdir(), "ipc-tests-exact-"))
  vi.spyOn(process, "cwd").mockReturnValue(cwd)
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

const writeResults = (value: unknown) => {
  mkdirSync(path.dirname(path.join(cwd, VITEST_RESULTS_PATH)), { recursive: true })
  writeFileSync(path.join(cwd, VITEST_RESULTS_PATH), JSON.stringify(value))
}
const REGISTRY = ".repo-contract/exceptions/skipped-tests.json"
const writeRegistry = (text: string) => {
  mkdirSync(path.join(cwd, ".repo-contract/exceptions"), { recursive: true })
  writeFileSync(path.join(cwd, REGISTRY), text)
}
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
const record = (name: string, over: Record<string, unknown> = {}) => ({
  id: deriveSkippedTestsId(name),
  version: 2,
  justification: "Installs its fixture in a separate CI job.",
  file: name,
  ...COMPLETE_V2,
  ...over,
})

describe("SKIPPED_TESTS_SCHEMA", () => {
  const validate = (records: unknown[]) => validateExceptionRegistry(records, SKIPPED_TESTS_SCHEMA)

  it("accepts a record whose id names its own file", () => {
    const result = validate([record("test/a.test.ts")])
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("invalid")
    expect(result.records[0]).toMatchObject({
      id: "skipped-test:test/a.test.ts",
      file: "test/a.test.ts",
    })
  })

  it("names the file field when it is missing or empty, and nothing else", () => {
    for (const bad of [undefined, "", 3]) {
      const result = validate([record("test/a.test.ts", { file: bad })])
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error("valid")
      expect(result.errors, String(bad)).toEqual([expect.stringContaining("exceptions[0].file")])
    }
  })

  it("rejects an id that does not match the file, quoting both", () => {
    const result = validate([record("test/a.test.ts", { id: "skipped-test:other.ts" })])
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("valid")
    expect(result.errors).toEqual([
      'exceptions[0].id "skipped-test:other.ts" does not match the id derived from its own file ("skipped-test:test/a.test.ts").',
    ])
  })
})

describe("skippedByFile()", () => {
  it("counts skipped and todo tests per file, forward-slashed and relative to the root", () => {
    const map = skippedByFile(
      {
        testResults: [
          file("test/a.test.ts", ["passed", "pending", "skipped", "todo", "failed"]),
          file("test/b.test.ts", ["todo", "todo"]),
          file("test/c.test.ts", ["passed"]),
        ],
      },
      cwd,
    )
    expect([...map]).toEqual([
      ["test/a.test.ts", { skipped: 2, todo: 1 }],
      ["test/b.test.ts", { skipped: 0, todo: 2 }],
    ])
  })

  it("is empty for a report with nothing in it, and copes with entries that lack fields", () => {
    expect(skippedByFile({}, cwd).size).toBe(0)
    expect(skippedByFile({ testResults: [] }, cwd).size).toBe(0)
    expect(skippedByFile({ testResults: [{}] }, cwd).size).toBe(0)
    expect(skippedByFile({ testResults: [{ name: "x", assertionResults: [{}] }] }, cwd).size).toBe(
      0,
    )
    expect([
      ...skippedByFile(
        { testResults: [{ assertionResults: [{ status: "pending" }] }] },
        cwd,
      ).keys(),
    ]).toEqual([""])
  })
})

describe("tests() skips", () => {
  it("lists the registry's load errors, one per line", async () => {
    writeResults(results([file("test/a.test.ts", ["pending"])]))
    writeRegistry(
      JSON.stringify({ exceptions: [{ id: "skipped-test:test/a.test.ts", version: 3 }] }),
    )
    const result = await run()
    expect(result.outcome).toBe("fail")
    const lines = result.rationale.split("\n")
    expect(lines[0]).toBe(`Tests: ${REGISTRY} failed to load:`)
    expect(lines.length).toBeGreaterThan(1)
    for (const line of lines.slice(1)) expect(line.startsWith("- ")).toBe(true)
    expect(result.rationale).toContain("version must be the number 2")
  })

  it("names what is missing from an incomplete record, with the counts of what was skipped", async () => {
    writeResults(results([file("test/a.test.ts", ["pending", "todo"])]))
    writeRegistry(JSON.stringify({ exceptions: [record("test/a.test.ts", { constraint: "" })] }))
    const result = await run()
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toBe(
      [
        "Tests: 2 test(s) did not run in 1 file(s), and 1 file(s) have no complete record of why:",
        "- test/a.test.ts: 1 skipped, 1 todo -- skipped-test:test/a.test.ts is incomplete (missing: constraint)",
      ].join("\n"),
    )
  })

  it("joins several missing fields with commas", async () => {
    writeResults(results([file("test/a.test.ts", ["pending"])]))
    writeRegistry(
      JSON.stringify({
        exceptions: [record("test/a.test.ts", { constraint: "", residualRisk: "" })],
      }),
    )
    expect((await run()).rationale).toContain("(missing: constraint, residualRisk)")
  })

  it("lists at most twenty unexplained files, and says how many more", async () => {
    const files = (count: number) =>
      Array.from({ length: count }, (_, i) =>
        file(`test/f${String(i).padStart(2, "0")}.test.ts`, ["pending"]),
      )
    writeResults(results(files(20)))
    const exactly = await run()
    expect(exactly.rationale.split("\n")).toHaveLength(21)
    expect(exactly.rationale).not.toContain("more.")
    writeResults(results(files(21)))
    const over = await run()
    const lines = over.rationale.split("\n")
    expect(lines).toHaveLength(22)
    expect(lines.at(-1)).toBe("...and 1 more.")
    expect(over.rationale).not.toContain("f20.test.ts")
    writeResults(results(files(25)))
    expect((await run()).rationale.split("\n").at(-1)).toBe("...and 5 more.")
  })

  it("passes a run with no skips at all with the delegated message", async () => {
    writeResults(results([file("test/a.test.ts", ["passed"])], 5))
    const result = await run()
    expect(result.outcome).toBe("pass")
    expect(result.rationale).toBe("Vitest completed 5 test(s) with 0 failures across 3 suite(s).")
  })

  it("passes, appending how many were skipped, when every file is explained", async () => {
    writeResults(results([file("test/a.test.ts", ["pending", "todo"])], 5))
    writeRegistry(JSON.stringify({ exceptions: [record("test/a.test.ts")] }))
    const result = await run()
    expect(result).toEqual({
      outcome: "pass",
      rationale: `Vitest completed 5 test(s) with 0 failures across 3 suite(s). 2 test(s) skipped in 1 file(s), each explained by a record in ${REGISTRY}.`,
    })
  })
})
