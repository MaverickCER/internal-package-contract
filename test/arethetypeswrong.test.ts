import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { arethetypeswrong } from "../checks/arethetypeswrong.js"
import { makeContext, makeResult } from "./support.js"

let cwd: string

beforeEach(() => {
  cwd = mkdtempSync(path.join(tmpdir(), "ipc-attw-test-"))
  vi.spyOn(process, "cwd").mockReturnValue(cwd)
})

afterEach(() => {
  vi.restoreAllMocks()
  rmSync(cwd, { recursive: true, force: true })
})

function writeReport(value: unknown): void {
  mkdirSync(path.join(cwd, "reports"), { recursive: true })
  writeFileSync(path.join(cwd, "reports/arethetypeswrong.json"), JSON.stringify(value), "utf8")
}

describe("arethetypeswrong", () => {
  it("fails when the report file was never produced (also covers abnormal termination)", async () => {
    const result = await arethetypeswrong.policy(makeContext(makeResult({ status: "timed_out" })))
    expect(result).toEqual({
      outcome: "fail",
      rationale: "TypeResolution: @arethetypeswrong/cli did not produce a readable JSON report.",
    })
  })

  it("fails when the report file is not valid JSON", async () => {
    mkdirSync(path.join(cwd, "reports"), { recursive: true })
    writeFileSync(path.join(cwd, "reports/arethetypeswrong.json"), "not json", "utf8")
    const result = await arethetypeswrong.policy(makeContext(makeResult()))
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain("did not produce a readable JSON report")
  })

  it("delegates a clean report to the underlying preset's pass verdict", async () => {
    writeReport({ problems: {} })
    const result = await arethetypeswrong.policy(makeContext(makeResult()))
    expect(result).toEqual({
      outcome: "pass",
      rationale: "@arethetypeswrong/cli found 0 packaged type-resolution problem(s).",
    })
  })

  it("does not throw and delegates unchanged when the report value is null (skips the node10 filter entirely)", async () => {
    writeReport(null)
    const result = await arethetypeswrong.policy(makeContext(makeResult()))
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain("invalid JSON")
  })

  it("does not throw and delegates unchanged when the report value is a non-object primitive", async () => {
    writeReport(42)
    const result = await arethetypeswrong.policy(makeContext(makeResult()))
    expect(result.outcome).toBe("fail")
  })

  it("does not throw when problems is missing entirely (raw is undefined)", async () => {
    writeReport({})
    const result = await arethetypeswrong.policy(makeContext(makeResult()))
    expect(result).toEqual({
      outcome: "pass",
      rationale: "@arethetypeswrong/cli found 0 packaged type-resolution problem(s).",
    })
  })

  it("does not throw and skips the filter when problems is a non-object primitive", async () => {
    writeReport({ problems: "not an object" })
    const result = await arethetypeswrong.policy(makeContext(makeResult()))
    expect(result).toEqual({
      outcome: "pass",
      rationale: "@arethetypeswrong/cli found 0 packaged type-resolution problem(s).",
    })
  })

  it("does not throw when a group's entry is null or a non-object primitive -- neither is a node10 problem, so both are kept through the filter", async () => {
    writeReport({
      problems: {
        FalseESM: [null, 42, { kind: "FalseESM", resolutionKind: "node16-esm", entrypoint: "." }],
      },
    })
    const result = await arethetypeswrong.policy(makeContext(makeResult()))
    expect(result.outcome).toBe("fail")
    // The preset's own evaluator then drops the null/primitive entries when
    // counting reportable problems -- only the one real object remains.
    expect(result.rationale).toContain("found 1 packaged type-resolution problem(s)")
  })

  it("drops the group's key entirely (not just to an empty array) once every entry is filtered out", async () => {
    writeReport({
      problems: {
        FalseCJS: [{ kind: "FalseCJS", resolutionKind: "node10", entrypoint: "." }],
        FalseESM: [{ kind: "FalseESM", resolutionKind: "node16-esm", entrypoint: "." }],
      },
    })
    const result = await arethetypeswrong.policy(makeContext(makeResult()))
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain("found 1 packaged type-resolution problem(s)")
  })

  it("drops node10-only problems before delegating, turning them into a pass", async () => {
    writeReport({
      problems: {
        FalseCJS: [{ kind: "FalseCJS", resolutionKind: "node10", entrypoint: "." }],
      },
    })
    const result = await arethetypeswrong.policy(makeContext(makeResult()))
    expect(result.outcome).toBe("pass")
  })

  it("keeps non-node10 problems and fails, listing them", async () => {
    writeReport({
      problems: {
        FalseESM: [{ kind: "FalseESM", resolutionKind: "node16-esm", entrypoint: "." }],
      },
    })
    const result = await arethetypeswrong.policy(makeContext(makeResult()))
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain("FalseESM")
    expect(result.rationale).toContain("found 1 packaged type-resolution problem(s)")
  })

  it("treats a non-array group value as carrying no problems, without throwing", async () => {
    writeReport({ problems: { FalseESM: "not an array" } })
    const result = await arethetypeswrong.policy(makeContext(makeResult()))
    expect(result).toEqual({
      outcome: "pass",
      rationale: "@arethetypeswrong/cli found 0 packaged type-resolution problem(s).",
    })
  })

  it("keeps a non-node10 problem in a group while dropping a node10 sibling in the same group", async () => {
    writeReport({
      problems: {
        FalseESM: [
          { kind: "FalseESM", resolutionKind: "node10", entrypoint: "." },
          { kind: "FalseESM", resolutionKind: "node16-esm", entrypoint: "./sub" },
        ],
      },
    })
    const result = await arethetypeswrong.policy(makeContext(makeResult()))
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain("found 1 packaged type-resolution problem(s)")
    expect(result.rationale).toContain("resolution=node16-esm")
  })

  it("wires run to the run-attw.mjs wrapper, excluding the schema entrypoint", () => {
    const run = arethetypeswrong.run as string[]
    expect(run[0]).toBe("node")
    expect(run.at(-1)).toBe("--exclude=schema")
  })
})
