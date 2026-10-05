import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { coderabbitai } from "../../../checks/coderabbitai.js"
import { makeContext, makeJsonParseFailure, makeJsonResult, makeResult } from "../../support.js"

let cwd: string
beforeEach(() => {
  cwd = mkdtempSync(path.join(tmpdir(), "ipc-coderabbit-policy-"))
  vi.spyOn(process, "cwd").mockReturnValue(cwd)
})
afterEach(() => {
  vi.restoreAllMocks()
  rmSync(cwd, { recursive: true, force: true })
})

const REGISTRY = ".repo-contract/exceptions/coderabbit.json"
const run = (evidence: unknown) => coderabbitai().policy(makeContext(makeJsonResult(evidence)))

describe("coderabbitai().policy", () => {
  it("records a CI run as a degradation naming the environment record that would accept it", async () => {
    const result = await run({
      status: "not-applicable",
      reason: "ci",
      expectedProvider: "coderabbit-github-app",
      registryPath: REGISTRY,
      existingRecordCount: 0,
    })
    expect(result.outcome).toBe("warn")
    expect(result.rationale).toContain("environment:CodeRabbit:not-applicable")
    expect(result.rationale).toContain("CodeRabbit did not run (ci)")
  })

  it("records an unavailable CLI the same way", async () => {
    const result = await run({
      status: "unavailable",
      reason: "cli-not-installed",
      registryPath: REGISTRY,
      existingRecordCount: 0,
    })
    expect(result.outcome).toBe("warn")
    expect(result.rationale).toContain("environment:CodeRabbit:unavailable")
  })

  it("fails a review error outright, and passes a clean review, neither as a degradation", async () => {
    const failed = await run({
      status: "error",
      message: "boom",
      registryPath: REGISTRY,
      existingRecordCount: 0,
    })
    expect(failed).toEqual({ outcome: "fail", rationale: "CodeRabbit review failed: boom" })
    const clean = await run({
      status: "reviewed",
      registryPath: REGISTRY,
      findings: [],
      activeExceptions: {},
      staleExceptions: [],
      scaffoldedIds: [],
    })
    expect(clean).toEqual({
      outcome: "pass",
      rationale: "0 CodeRabbit finding(s) evaluated: all permitted by a complete exception record.",
    })
  })

  it("fails when the script never ran or its output was not JSON", async () => {
    const spawnFailed = await coderabbitai().policy(
      makeContext(
        makeResult({ status: "spawn_error", spawnError: "not found", spawnErrorCode: "ENOENT" }),
      ),
    )
    expect(spawnFailed.outcome).toBe("fail")
    expect(spawnFailed.rationale).toContain("tsx could not be spawned (ENOENT): not found")
    const unparsed = await coderabbitai().policy(
      makeContext(makeJsonParseFailure("bad", { stdout: "text" })),
    )
    expect(unparsed).toEqual({
      outcome: "fail",
      rationale:
        "CodeRabbit: scripts/coderabbitai/review.ts output could not be parsed as JSON. bad\ntext",
    })
  })
})
