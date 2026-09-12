import { describe, expect, it } from "vitest"
import { DEFAULT_ACCEPTED_SECURITY_DEPS_EXCEPTIONS, securityDeps } from "../checks/security-deps.js"
import { makeContext, makeJsonResult, makeResult } from "./support.js"

function auditReport(vulnerabilities: Record<string, { severity: string }>) {
  const counts = { info: 0, low: 0, moderate: 0, high: 0, critical: 0 }
  for (const v of Object.values(vulnerabilities)) {
    if (v.severity in counts) counts[v.severity as keyof typeof counts] += 1
  }
  return {
    vulnerabilities,
    metadata: {
      vulnerabilities: { ...counts, total: Object.values(counts).reduce((a, b) => a + b, 0) },
    },
  }
}

describe("securityDeps()", () => {
  it("delegates straight to the preset's own policy when the run itself failed", async () => {
    const check = securityDeps()
    const result = await check.policy(makeContext(makeResult({ status: "timed_out" })))
    expect(result.outcome).toBe("fail")
  })

  it("passes when every finding is in the default accepted-exceptions set", async () => {
    const check = securityDeps()
    const report = auditReport({
      vitest: { severity: "moderate" },
      pacote: { severity: "high" },
    })
    const result = await check.policy(makeContext(makeJsonResult(report)))
    expect(result.outcome).toBe("pass")
  })

  it("still fails on a genuinely new, unreviewed vulnerability", async () => {
    const check = securityDeps()
    const report = auditReport({
      vitest: { severity: "moderate" },
      "left-pad": { severity: "critical" },
    })
    const result = await check.policy(makeContext(makeJsonResult(report)))
    expect(result.outcome).toBe("fail")
  })

  it("accepts a consumer-supplied exception on top of the default set", async () => {
    const check = securityDeps({ acceptedExceptions: ["left-pad"] })
    const report = auditReport({
      vitest: { severity: "moderate" },
      "left-pad": { severity: "critical" },
    })
    const result = await check.policy(makeContext(makeJsonResult(report)))
    expect(result.outcome).toBe("pass")
  })

  it("recomputes metadata.vulnerabilities counts from only what remains after filtering", async () => {
    const check = securityDeps()
    const report = auditReport({
      vitest: { severity: "moderate" }, // accepted, dropped
      "left-pad": { severity: "critical" }, // not accepted, kept
    })
    const result = await check.policy(makeContext(makeJsonResult(report)))
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain("left-pad")
    expect(result.rationale).not.toContain("vitest")
  })

  it("passes through non-object output values unchanged (defensive, never throws)", async () => {
    const check = securityDeps()
    const result = await check.policy(makeContext(makeJsonResult(null)))
    expect(result).toBeDefined()
  })

  it("exports the default set as a real, non-empty ReadonlySet", () => {
    expect(DEFAULT_ACCEPTED_SECURITY_DEPS_EXCEPTIONS.size).toBeGreaterThan(0)
    expect(DEFAULT_ACCEPTED_SECURITY_DEPS_EXCEPTIONS.has("vitest")).toBe(true)
  })
})
