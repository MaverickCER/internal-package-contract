import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { coderabbitai } from "../checks/coderabbitai.js"
import { makeContext, makeJsonResult, makeResult } from "./support.js"

let cwd: string

beforeEach(() => {
  cwd = mkdtempSync(path.join(tmpdir(), "ipc-coderabbitai-test-"))
  vi.spyOn(process, "cwd").mockReturnValue(cwd)
})

afterEach(() => {
  vi.restoreAllMocks()
  rmSync(cwd, { recursive: true, force: true })
})

function registryPath(): string {
  return path.join(process.cwd(), ".repo-contract/exceptions/coderabbit.json")
}

function writeRegistry(exceptions: readonly unknown[]): void {
  mkdirSync(path.dirname(registryPath()), { recursive: true })
  writeFileSync(registryPath(), JSON.stringify({ exceptions }), "utf8")
}

function readRegistry(): { exceptions: readonly Record<string, unknown>[] } {
  return JSON.parse(readFileSync(registryPath(), "utf8"))
}

function finding(overrides: Partial<Record<string, unknown>> = {}) {
  const base = { file: "checks/lint.ts", severity: "major", summary: "Unused variable `foo`." }
  const f = { ...base, ...overrides }
  return { id: `coderabbit:${f.file}:${f.severity}:abc123def456`, ...f }
}

function reviewedResult(findings: readonly unknown[]) {
  return makeJsonResult({ status: "reviewed", findings })
}

function completeRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const f = finding()
  return {
    id: f.id,
    version: 1,
    justification: "Confirmed false positive: the variable is used via destructuring below.",
    alternatives: "None -- the finding does not apply.",
    remediation: "N/A.",
    method: "independent-human-review",
    exceptionType: "accepted-risk",
    file: f.file,
    severity: f.severity,
    summary: f.summary,
    ...overrides,
  }
}

describe("coderabbitai", () => {
  it("fails when the check terminated abnormally", async () => {
    const result = await coderabbitai.policy(makeContext(makeResult({ status: "timed_out" })))
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain("did not run to completion")
  })

  it("fails when the output could not be parsed as JSON", async () => {
    const result = await coderabbitai.policy(
      makeContext(makeResult({ output: { format: "json", success: false, error: "bad" } })),
    )
    expect(result).toEqual({
      outcome: "fail",
      rationale: "check-coderabbitai output could not be parsed as JSON.",
    })
  })

  it("warns on not-applicable (CI)", async () => {
    const result = await coderabbitai.policy(
      makeContext(
        makeJsonResult({
          status: "not-applicable",
          reason: "ci",
          expectedProvider: "coderabbit-github-app",
        }),
      ),
    )
    expect(result.outcome).toBe("warn")
    expect(result.rationale).toContain("delegated to the coderabbit-github-app")
  })

  it("warns on unavailable (CLI not installed)", async () => {
    const result = await coderabbitai.policy(
      makeContext(makeJsonResult({ status: "unavailable", reason: "cli-not-installed" })),
    )
    expect(result.outcome).toBe("warn")
    expect(result.rationale).toContain("cli-not-installed")
  })

  it("fails on a review error", async () => {
    const result = await coderabbitai.policy(
      makeContext(makeJsonResult({ status: "error", message: "boom" })),
    )
    expect(result).toEqual({ outcome: "fail", rationale: "coderabbitai review failed: boom" })
  })

  it("passes with zero findings and leaves an empty registry alone", async () => {
    const result = await coderabbitai.policy(makeContext(reviewedResult([])))
    expect(result).toEqual({
      outcome: "pass",
      rationale: "0 CodeRabbit finding(s) evaluated: all permitted by a complete exception record.",
    })
  })

  it("fails and scaffolds a blank stub for a new, unmatched finding", async () => {
    const f = finding()
    const result = await coderabbitai.policy(makeContext(reviewedResult([f])))
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain(
      "exception incomplete (missing: justification, alternatives, remediation, method, exceptionType)",
    )

    const written = readRegistry().exceptions
    expect(written).toHaveLength(1)
    expect(written[0]).toMatchObject({ id: f.id, justification: "", file: f.file })
  })

  it("passes a finding with a complete, matching exception record", async () => {
    const f = finding()
    writeRegistry([completeRecord()])
    const result = await coderabbitai.policy(makeContext(reviewedResult([f])))
    expect(result).toEqual({
      outcome: "pass",
      rationale: "1 CodeRabbit finding(s) evaluated: all permitted by a complete exception record.",
    })
  })

  it("rejects validated-false-positive -- no tool can mechanically re-verify an AI opinion", async () => {
    writeRegistry([completeRecord({ exceptionType: "validated-false-positive" })])
    const result = await coderabbitai.policy(makeContext(reviewedResult([])))
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain("failed to load")
  })

  it("reports a stale record that matches no current finding", async () => {
    writeRegistry([completeRecord()])
    const result = await coderabbitai.policy(makeContext(reviewedResult([])))
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain("no longer raises this finding")
  })

  it("fails when the on-disk registry is malformed", async () => {
    mkdirSync(path.dirname(registryPath()), { recursive: true })
    writeFileSync(
      registryPath(),
      JSON.stringify({ exceptions: [{ id: "not-namespaced", version: 1 }] }),
      "utf8",
    )
    const result = await coderabbitai.policy(makeContext(reviewedResult([])))
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain("failed to load")
  })
})
