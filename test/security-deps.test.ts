import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  createSecurityDepsStub,
  deriveSecurityDepsExceptionId,
  evaluateFinding,
  normalizeFindings,
  SECURITY_DEPS_EXCEPTION_SCHEMA,
  securityDeps,
} from "../checks/security-deps.js"
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
  it("fails with the exact tool-labeled rationale when npm audit terminated abnormally", async () => {
    const check = securityDeps()
    const result = await check.policy(makeContext(makeResult({ status: "timed_out" })))
    expect(result).toEqual({
      outcome: "fail",
      rationale: "npm audit did not run to completion (status: timed_out).",
    })
  })

  it("fails when npm audit's own output field is entirely absent, without throwing", async () => {
    const check = securityDeps()
    const result = await check.policy(makeContext(makeResult({ status: "completed" })))
    expect(result).toEqual({
      outcome: "fail",
      rationale: "npm audit output could not be parsed as JSON.",
    })
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

  it("treats a version-range change as a genuinely new finding, combining the exact offender/stale counts and text", async () => {
    writeRegistry([completeRecord()])
    const check = securityDeps()
    // Same package, but a new advisory / different range -- the old record must not silently
    // cover it.
    const result = await check.policy(
      makeContext(auditResult({ vitest: { severity: "moderate", range: "4.0.0" } })),
    )
    expect(result).toEqual({
      outcome: "fail",
      rationale: [
        "2 npm audit finding(s) or stale record(s) need attention:",
        "- security-deps:vitest@4.0.0 [moderate]: exception incomplete (missing: justification, alternatives, remediation, method, exceptionType)",
        '- Stale exception in .repo-contract/exceptions/security-deps.json: "security-deps:vitest@3.0.0 - 3.2.7" -- npm audit no longer reports this vulnerability; delete this entry.',
      ].join("\n"),
    })
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

  it("fails with the exact rendered error list when the on-disk registry is malformed", async () => {
    mkdirSync(path.dirname(registryPath()), { recursive: true })
    writeFileSync(
      registryPath(),
      JSON.stringify({ exceptions: [{ id: "not-namespaced", version: 1 }] }),
      "utf8",
    )
    const check = securityDeps()
    const result = await check.policy(makeContext(auditResult({})))
    expect(result).toEqual({
      outcome: "fail",
      rationale: [
        ".repo-contract/exceptions/security-deps.json failed to load and was left unchanged:",
        '- exceptions[0].id must be a non-empty string beginning with "security-deps:" (got "not-namespaced").',
        "- exceptions[0].justification must be a string.",
      ].join("\n"),
    })
  })

  it("runs the exact npm audit invocation", () => {
    expect(securityDeps().run).toEqual(["npm", "audit", "--omit=dev", "--json"])
    expect(securityDeps().output).toEqual({ format: "json" })
  })

  it("fails with the persisted-write rationale when the registry path is a symlink", async () => {
    const target = path.join(cwd, "real-registry.json")
    writeFileSync(target, JSON.stringify({ exceptions: [] }), "utf8")
    mkdirSync(path.dirname(registryPath()), { recursive: true })
    symlinkSync(target, registryPath())
    const check = securityDeps()
    const result = await check.policy(
      makeContext(auditResult({ vitest: { severity: "moderate", range: "3.0.0 - 3.2.7" } })),
    )
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain("is a symlink")
  })

  it("fails when npm audit's own output.success is true but output.value is a non-object", async () => {
    const check = securityDeps()
    const result = await check.policy(makeContext(makeJsonResult("nope")))
    expect(result).toEqual({
      outcome: "fail",
      rationale: "npm audit produced invalid JSON report data.",
    })
  })
})

describe("deriveSecurityDepsExceptionId()", () => {
  it("joins package/range into the security-deps: id", () => {
    expect(deriveSecurityDepsExceptionId({ package: "vitest", range: "3.0.0 - 3.2.7" })).toBe(
      "security-deps:vitest@3.0.0 - 3.2.7",
    )
  })
})

describe("createSecurityDepsStub()", () => {
  it("returns a fully blank stub with the finding's identity fields mapped in", () => {
    const finding = {
      id: "security-deps:vitest@3.0.0 - 3.2.7",
      package: "vitest",
      range: "3.0.0 - 3.2.7",
      severity: "moderate" as const,
    }
    expect(createSecurityDepsStub(finding, finding.id)).toEqual({
      id: "security-deps:vitest@3.0.0 - 3.2.7",
      version: 1,
      justification: "",
      alternatives: "",
      remediation: "",
      method: "",
      exceptionType: "",
      package: "vitest",
      range: "3.0.0 - 3.2.7",
      severity: "moderate",
    })
  })
})

describe("normalizeFindings()", () => {
  it("returns an empty array when vulnerabilities is absent", () => {
    expect(normalizeFindings({})).toEqual([])
  })
  it("returns an empty array when vulnerabilities is empty", () => {
    expect(normalizeFindings({ vulnerabilities: {} })).toEqual([])
  })
  it("normalizes a recognized severity value exactly", () => {
    expect(
      normalizeFindings({
        vulnerabilities: { vitest: { severity: "moderate", range: "3.0.0 - 3.2.7" } },
      }),
    ).toEqual([
      {
        id: "security-deps:vitest@3.0.0 - 3.2.7",
        package: "vitest",
        range: "3.0.0 - 3.2.7",
        severity: "moderate",
      },
    ])
  })
  it("normalizes a missing severity to unknown", () => {
    const [finding] = normalizeFindings({
      vulnerabilities: { vitest: { severity: undefined as unknown as string, range: "1.0.0" } },
    })
    expect(finding?.severity).toBe("unknown")
  })
  it("normalizes an unrecognized severity string to unknown", () => {
    const [finding] = normalizeFindings({
      vulnerabilities: { vitest: { severity: "extreme", range: "1.0.0" } },
    })
    expect(finding?.severity).toBe("unknown")
  })
  it("normalizes a missing range to the literal string unknown", () => {
    const [finding] = normalizeFindings({
      vulnerabilities: { vitest: { severity: "moderate" } },
    })
    expect(finding?.range).toBe("unknown")
  })
  it("normalizes an empty-string range to the literal string unknown", () => {
    const [finding] = normalizeFindings({
      vulnerabilities: { vitest: { severity: "moderate", range: "" } },
    })
    expect(finding?.range).toBe("unknown")
  })
  it("normalizes a non-string range to the literal string unknown", () => {
    const [finding] = normalizeFindings({
      vulnerabilities: { vitest: { severity: "moderate", range: 42 as unknown as string } },
    })
    expect(finding?.range).toBe("unknown")
  })
  it("produces one finding per vulnerable package, in encounter order", () => {
    const findings = normalizeFindings({
      vulnerabilities: {
        vitest: { severity: "moderate", range: "3.0.0 - 3.2.7" },
        "left-pad": { severity: "low", range: "1.0.0" },
      },
    })
    expect(findings.map((f) => f.package)).toEqual(["vitest", "left-pad"])
  })
})

describe("evaluateFinding()", () => {
  const finding = {
    id: "security-deps:vitest@3.0.0 - 3.2.7",
    package: "vitest",
    range: "3.0.0 - 3.2.7",
    severity: "moderate" as const,
  }
  it("is unmatched when there is no record", () => {
    expect(evaluateFinding(finding, undefined)).toEqual({ verdict: "unmatched", missing: [] })
  })
  it("is insufficient when the record is missing required fields, listing exactly what's missing", () => {
    const record = {
      id: finding.id,
      version: 1 as const,
      justification: "",
      alternatives: "",
      remediation: "",
      method: "" as const,
      exceptionType: "" as const,
      package: "vitest",
      range: "3.0.0 - 3.2.7",
      severity: "moderate" as const,
    }
    expect(evaluateFinding(finding, record)).toEqual({
      verdict: "insufficient",
      missing: ["justification", "alternatives", "remediation", "method", "exceptionType"],
    })
  })
  it("is permitted when the record is complete", () => {
    const record = {
      id: finding.id,
      version: 1 as const,
      justification: "j",
      alternatives: "a",
      remediation: "r",
      method: "independent-human-review" as const,
      exceptionType: "accepted-risk" as const,
      package: "vitest",
      range: "3.0.0 - 3.2.7",
      severity: "moderate" as const,
    }
    expect(evaluateFinding(finding, record)).toEqual({ verdict: "permitted", missing: [] })
  })
  it("requires the full field set even for a critical-severity finding", () => {
    const record = {
      id: finding.id,
      version: 1 as const,
      justification: "",
      alternatives: "",
      remediation: "",
      method: "" as const,
      exceptionType: "" as const,
      package: "vitest",
      range: "3.0.0 - 3.2.7",
      severity: "critical" as const,
    }
    expect(evaluateFinding({ ...finding, severity: "critical" }, record)).toEqual({
      verdict: "insufficient",
      missing: ["justification", "alternatives", "remediation", "method", "exceptionType"],
    })
  })
})

describe("SECURITY_DEPS_EXCEPTION_SCHEMA.validateRecord()", () => {
  const core = { id: "security-deps:vitest@3.0.0 - 3.2.7", version: 1 as const, justification: "" }
  function validRaw(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      alternatives: "",
      remediation: "",
      method: "",
      exceptionType: "",
      package: "vitest",
      range: "3.0.0 - 3.2.7",
      severity: "moderate",
      ...overrides,
    }
  }

  it("builds the full record when every field is valid and the id matches", () => {
    const errors: string[] = []
    const record = SECURITY_DEPS_EXCEPTION_SCHEMA.validateRecord(core, validRaw(), 0, errors)
    expect(errors).toEqual([])
    expect(record).toEqual({
      id: "security-deps:vitest@3.0.0 - 3.2.7",
      version: 1,
      justification: "",
      alternatives: "",
      remediation: "",
      method: "",
      exceptionType: "",
      package: "vitest",
      range: "3.0.0 - 3.2.7",
      severity: "moderate",
    })
  })
  it("returns undefined when the security fields are invalid", () => {
    const errors: string[] = []
    const record = SECURITY_DEPS_EXCEPTION_SCHEMA.validateRecord(
      core,
      validRaw({ method: "not-a-method" }),
      0,
      errors,
    )
    expect(record).toBeUndefined()
    expect(errors.length).toBeGreaterThan(0)
  })
  it("returns undefined when package is missing/empty", () => {
    const errors: string[] = []
    const record = SECURITY_DEPS_EXCEPTION_SCHEMA.validateRecord(
      core,
      validRaw({ package: "" }),
      0,
      errors,
    )
    expect(record).toBeUndefined()
    expect(errors).toContain("exceptions[0].package must be a non-empty string.")
  })
  it("returns undefined when range is missing/empty", () => {
    const errors: string[] = []
    const record = SECURITY_DEPS_EXCEPTION_SCHEMA.validateRecord(
      core,
      validRaw({ range: "" }),
      0,
      errors,
    )
    expect(record).toBeUndefined()
    expect(errors).toContain("exceptions[0].range must be a non-empty string.")
  })
  it("accepts every recognized severity value, including unknown", () => {
    for (const severity of ["info", "low", "moderate", "high", "critical", "unknown"]) {
      const errors: string[] = []
      const idCore = { ...core }
      const record = SECURITY_DEPS_EXCEPTION_SCHEMA.validateRecord(
        idCore,
        validRaw({ severity }),
        0,
        errors,
      )
      expect(errors).toEqual([])
      expect(record?.severity).toBe(severity)
    }
  })
  it("returns undefined and pushes the exact message when severity is not a recognized value", () => {
    const errors: string[] = []
    const record = SECURITY_DEPS_EXCEPTION_SCHEMA.validateRecord(
      core,
      validRaw({ severity: "extreme" }),
      0,
      errors,
    )
    expect(record).toBeUndefined()
    expect(errors).toContain(
      'exceptions[0].severity must be one of "info", "low", "moderate", "high", "critical", "unknown" (got "extreme").',
    )
  })
  it("returns undefined when severity is not a string at all", () => {
    const errors: string[] = []
    const record = SECURITY_DEPS_EXCEPTION_SCHEMA.validateRecord(
      core,
      validRaw({ severity: 42 }),
      0,
      errors,
    )
    expect(record).toBeUndefined()
  })
  it("returns undefined and reports a mismatched id, without ever double-reporting field errors", () => {
    const errors: string[] = []
    const mismatchedCore = { ...core, id: "security-deps:wrong@1.0.0" }
    const record = SECURITY_DEPS_EXCEPTION_SCHEMA.validateRecord(
      mismatchedCore,
      validRaw(),
      0,
      errors,
    )
    expect(record).toBeUndefined()
    expect(errors).toEqual([
      'exceptions[0].id "security-deps:wrong@1.0.0" does not match the id derived from its own package/range ("security-deps:vitest@3.0.0 - 3.2.7").',
    ])
  })
})
