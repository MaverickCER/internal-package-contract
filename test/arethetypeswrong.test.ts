import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import fsPromises from "node:fs/promises"
import { syncBuiltinESMExports } from "node:module"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { CheckDefinitionConfig } from "repo-contract"
import { typeResolutionCheck } from "../checks/arethetypeswrong.js"
import { standardTier } from "../checks/strict.js"
import { makeContext, makeResult } from "./support.js"

let cwd: string
let arethetypeswrong: CheckDefinitionConfig

// repo-contract's not-applicable rule reads `package.json` relative to the real working directory.
// `process.chdir` is unsupported in the worker threads Stryker's runner uses, so that one read is
// redirected into the temp dir instead.
beforeEach(() => {
  cwd = mkdtempSync(path.join(tmpdir(), "ipc-attw-test-"))
  vi.spyOn(process, "cwd").mockReturnValue(cwd)
  const realReadFile = fsPromises.readFile.bind(fsPromises)
  vi.spyOn(fsPromises, "readFile").mockImplementation(((file: unknown, ...rest: unknown[]) =>
    realReadFile(
      (file === "package.json" ? path.join(cwd, "package.json") : file) as string,
      ...(rest as []),
    )) as typeof fsPromises.readFile)
  syncBuiltinESMExports()
  arethetypeswrong = typeResolutionCheck(standardTier({}).checks.TypeResolution)
})

afterEach(() => {
  vi.restoreAllMocks()
  syncBuiltinESMExports()
  rmSync(cwd, { recursive: true, force: true })
})

function writeReport(value: unknown): void {
  mkdirSync(path.join(cwd, "reports"), { recursive: true })
  writeFileSync(path.join(cwd, "reports/arethetypeswrong.json"), JSON.stringify(value), "utf8")
}

describe("arethetypeswrong", () => {
  it("fails with the abnormal-termination rationale when the run itself timed out, before ever touching the report file", async () => {
    const result = await arethetypeswrong.policy(makeContext(makeResult({ status: "timed_out" })))
    expect(result).toEqual({
      outcome: "fail",
      rationale:
        "TypeResolution: @arethetypeswrong/cli did not run to completion (status: timed_out).",
    })
  })

  it("hands the tier's policy the report as JSON output, and a missing report as a failed parse", async () => {
    const seen: unknown[] = []
    const check = typeResolutionCheck({
      run: ["attw"],
      policy: (ctx) => {
        seen.push(ctx.result.output)
        return { outcome: "pass", rationale: "ok" }
      },
    })
    await check.policy(makeContext(makeResult()))
    writeReport({ problems: {} })
    await check.policy(makeContext(makeResult()))
    expect(seen).toEqual([
      { format: "json", success: false, error: expect.stringContaining("ENOENT") },
      { format: "json", success: true, value: { problems: {} } },
    ])
  })

  it("fails when the report file was never produced despite a completed run", async () => {
    const result = await arethetypeswrong.policy(makeContext(makeResult()))
    expect(result).toEqual({
      outcome: "fail",
      rationale: "TypeResolution: @arethetypeswrong/cli did not produce a readable JSON report.",
    })
  })

  it("appends the run's own stdout/stderr to the unreadable-report rationale, so a crash inside run-attw.mjs is diagnosable without a separate log lookup", async () => {
    const result = await arethetypeswrong.policy(
      makeContext(makeResult({ stderr: "Error: npm pack failed (exit 1):\nENOENT" })),
    )
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain("did not produce a readable JSON report")
    expect(result.rationale).toContain("Error: npm pack failed (exit 1):\nENOENT")
  })

  it("truncates a long run output tail to exactly the last 3000 characters when the report file is missing", async () => {
    const longOutput = "a".repeat(3500) + "END"
    const result = await arethetypeswrong.policy(makeContext(makeResult({ stdout: longOutput })))
    const tail = result.rationale.split("\n").at(-1) ?? ""
    expect(tail.length).toBe(3000)
    expect(tail.endsWith("END")).toBe(true)
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
    // counting reportable problems: only the one real object remains.
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

  it("passes a private package as not applicable, whatever the run left behind", async () => {
    writeFileSync(path.join(cwd, "package.json"), JSON.stringify({ private: true }))
    const result = await arethetypeswrong.policy(makeContext(makeResult()))
    expect(result).toEqual({
      outcome: "pass",
      rationale:
        'TypeResolution is not applicable: package.json sets "private": true, so the package is never published.',
    })
  })

  it("still fails a private package whose run did not finish", async () => {
    writeFileSync(path.join(cwd, "package.json"), JSON.stringify({ private: true }))
    const result = await arethetypeswrong.policy(makeContext(makeResult({ status: "timed_out" })))
    expect(result.outcome).toBe("fail")
  })

  it("keeps the tier's other fields, but reads the report file instead of stdout", () => {
    const tier = standardTier({}).checks.TypeResolution
    const wrapped = typeResolutionCheck({ ...tier, timeoutMs: 5 })
    expect(wrapped.timeoutMs).toBe(5)
    expect(wrapped.output).toBeUndefined()
    expect(wrapped.policy).not.toBe(tier.policy)
  })

  it("wires run to the run-attw.mjs wrapper, excluding the schema entrypoint", () => {
    const run = arethetypeswrong.run as string[]
    expect(run[0]).toBe("node")
    expect(run.at(-1)).toBe("--exclude=schema")
  })
})
