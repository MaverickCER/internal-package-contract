import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { securityDeps } from "../checks/security-deps.js"
import { makeContext, makeJsonResult, makeResult } from "./support.js"

function deriveId(finding: { readonly package: string; readonly range: string }): string {
  return `security-deps:${finding.package}@${finding.range}`
}

let cwd: string

beforeEach(() => {
  cwd = mkdtempSync(path.join(tmpdir(), "ipc-security-deps-test-"))
  vi.spyOn(process, "cwd").mockReturnValue(cwd)
})

afterEach(() => {
  vi.restoreAllMocks()
  rmSync(cwd, { recursive: true, force: true })
})

function registryPath(): string {
  return path.join(process.cwd(), ".repo-contract/exceptions/security-deps.json")
}

function writeRegistry(exceptions: readonly unknown[]): void {
  mkdirSync(path.dirname(registryPath()), { recursive: true })
  writeFileSync(registryPath(), JSON.stringify({ exceptions }), "utf8")
}

function readRegistry(): { exceptions: readonly Record<string, unknown>[] } {
  return JSON.parse(readFileSync(registryPath(), "utf8"))
}

function auditResult(vulnerabilities: Record<string, { severity: string; range?: string }>) {
  return makeJsonResult({ vulnerabilities })
}

function completeRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const base = {
    id: deriveId({ package: "vitest", range: "3.0.0 - 3.2.7" }),
    version: 1,
    justification: "Coverage-instrumentation-only vulnerability; no consumer code path reaches it.",
    alternatives: "None -- a major bump is not yet verified against this package's own config.",
    remediation: "Revisit when vitest ships a patched release in the current major line.",
    method: "independent-human-review",
    exceptionType: "accepted-risk",
    package: "vitest",
    range: "3.0.0 - 3.2.7",
    severity: "moderate",
  }
  return { ...base, ...overrides }
}

describe("securityDeps()", () => {
  it("fails when npm audit terminated abnormally", async () => {
    const check = securityDeps()
    const result = await check.policy(makeContext(makeResult({ status: "timed_out" })))
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain("did not run to completion")
  })

  it("fails when npm audit's own output could not be parsed as JSON", async () => {
    const check = securityDeps()
    const result = await check.policy(
      makeContext(makeResult({ output: { format: "json", success: false, error: "bad" } })),
    )
    expect(result).toEqual({
      outcome: "fail",
      rationale: "npm audit output could not be parsed as JSON.",
    })
  })

  it("fails when npm audit produced non-object JSON", async () => {
    const check = securityDeps()
    const result = await check.policy(makeContext(makeJsonResult(null)))
    expect(result).toEqual({
      outcome: "fail",
      rationale: "npm audit produced invalid JSON report data.",
    })
  })

  it("passes with zero vulnerabilities and leaves an empty registry alone", async () => {
    const check = securityDeps()
    const result = await check.policy(makeContext(auditResult({})))
    expect(result).toEqual({
      outcome: "pass",
      rationale: "0 npm audit finding(s) evaluated: all permitted by a complete exception record.",
    })
  })

  it("fails and scaffolds a blank stub for a new, unmatched finding -- never silently accepted", async () => {
    const check = securityDeps()
    const result = await check.policy(
      makeContext(auditResult({ vitest: { severity: "moderate", range: "3.0.0 - 3.2.7" } })),
    )
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain(
      "exception incomplete (missing: justification, alternatives, remediation, method, exceptionType)",
    )

    const written = readRegistry().exceptions
    expect(written).toHaveLength(1)
    expect(written[0]).toMatchObject({
      id: deriveId({ package: "vitest", range: "3.0.0 - 3.2.7" }),
      justification: "",
      package: "vitest",
      range: "3.0.0 - 3.2.7",
      severity: "moderate",
    })
  })

  it("passes a finding with a complete, matching exception record -- the raw evidence is never stripped, only evaluated", async () => {
    writeRegistry([completeRecord()])
    const check = securityDeps()
    const result = await check.policy(
      makeContext(auditResult({ vitest: { severity: "moderate", range: "3.0.0 - 3.2.7" } })),
    )
    expect(result).toEqual({
      outcome: "pass",
      rationale: "1 npm audit finding(s) evaluated: all permitted by a complete exception record.",
    })
  })

  it("fails an incomplete exception record, listing exactly which fields are missing", async () => {
    writeRegistry([completeRecord({ alternatives: "", remediation: "" })])
    const check = securityDeps()
    const result = await check.policy(
      makeContext(auditResult({ vitest: { severity: "moderate", range: "3.0.0 - 3.2.7" } })),
    )
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain("exception incomplete (missing: alternatives, remediation)")
  })

  it("requires the full field set even for a critical-severity finding -- no severity-tiered forbidding here", async () => {
    writeRegistry([completeRecord({ severity: "critical" })])
    const check = securityDeps()
    const result = await check.policy(
      makeContext(auditResult({ vitest: { severity: "critical", range: "3.0.0 - 3.2.7" } })),
    )
    expect(result.outcome).toBe("pass")
  })

  it("reports a stale record that matches no current finding", async () => {
    writeRegistry([completeRecord()])
    const check = securityDeps()
    const result = await check.policy(makeContext(auditResult({})))
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain("npm audit no longer reports this vulnerability")
  })

  it("treats a version-range change as a genuinely new finding, not a match against the old exception", async () => {
    writeRegistry([completeRecord()])
    const check = securityDeps()
    // Same package, but a new advisory / different range -- the old record must not silently
    // cover it.
    const result = await check.policy(
      makeContext(auditResult({ vitest: { severity: "moderate", range: "4.0.0" } })),
    )
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain("exception incomplete")
    expect(result.rationale).toContain("npm audit no longer reports this vulnerability")
  })

  it("normalizes a missing/unrecognized severity to unknown rather than crashing", async () => {
    const check = securityDeps()
    const result = await check.policy(
      makeContext(auditResult({ "left-pad": { severity: "nonsense" as never } })),
    )
    expect(result.outcome).toBe("fail")
    const written = readRegistry().exceptions
    expect(written[0]).toMatchObject({ severity: "unknown" })
  })

  it("fails when the on-disk registry is malformed", async () => {
    mkdirSync(path.dirname(registryPath()), { recursive: true })
    writeFileSync(
      registryPath(),
      JSON.stringify({ exceptions: [{ id: "not-namespaced", version: 1 }] }),
      "utf8",
    )
    const check = securityDeps()
    const result = await check.policy(makeContext(auditResult({})))
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain("failed to load")
  })
})
