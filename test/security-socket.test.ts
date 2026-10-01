import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  createSocketStub,
  deriveSocketExceptionId,
  evaluateAlert,
  evaluateFinalVerdict,
  interpretSocketRun,
  isAuthError,
  classifyProblem,
  isPlainObject,
  isValidOptionalEnumField,
  normalizeAlert,
  parseExample,
  safeString,
  securitySocket,
  SOCKET_EXCEPTION_SCHEMA,
} from "../checks/security-socket.js"
import { makeContext, makeResult } from "./support.js"

/** Mirrors security-socket.ts's own private `deriveSocketExceptionId` exactly. */
function deriveId(alert: {
  readonly package: string
  readonly version: string
  readonly type: string
}): string {
  return `socket:${alert.package}@${alert.version}:${alert.type}`
}

let cwd: string

beforeEach(() => {
  cwd = mkdtempSync(path.join(tmpdir(), "ipc-security-socket-test-"))
  vi.spyOn(process, "cwd").mockReturnValue(cwd)
})

afterEach(() => {
  vi.restoreAllMocks()
  // Windows can hold a just-exited child's cwd for a moment, so retry the removal.
  rmSync(cwd, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

function registryPath(): string {
  return path.join(process.cwd(), ".repo-contract/exceptions/socket.json")
}

function writeRegistry(exceptions: readonly unknown[]): void {
  mkdirSync(path.dirname(registryPath()), { recursive: true })
  writeFileSync(registryPath(), JSON.stringify({ exceptions }), "utf8")
}

function readRegistry(): { exceptions: readonly Record<string, unknown>[] } {
  return JSON.parse(readFileSync(registryPath(), "utf8"))
}

function scriptOutput(
  body: unknown,
  overrides: Parameters<typeof makeResult>[0] = {},
): ReturnType<typeof makeResult> {
  return makeResult({ stdout: JSON.stringify(body), ...overrides })
}

/** One flattened alert exactly as scripts/socket-package-score.mjs emits it. */
function scoreAlert(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: "unmaintained",
    severity: "middle",
    category: "maintenance",
    example: "npm/left-pad@1.0.0",
    scope: "transitive",
    ...overrides,
  }
}

function okScore(alerts: readonly unknown[], extra: Record<string, unknown> = {}): unknown {
  return { ok: true, data: { alerts, requestedVersion: "1.0.0", scoredVersion: "1.0.0", ...extra } }
}

const LOCAL_ENV = {}
const CI_ENV = { CI: "true" }

function completeRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const base = {
    id: deriveId({ package: "left-pad", version: "1.0.0", type: "unmaintained" }),
    version: 1,
    justification: "Reads PORT only, matches documented behavior.",
    alternatives: "None -- transitive, not a direct choice.",
    remediation: "None planned.",
    method: "independent-human-review",
    exceptionType: "accepted-risk",
    package: "left-pad",
    packageVersion: "1.0.0",
    type: "unmaintained",
    severity: "middle",
  }
  return { ...base, ...overrides }
}

describe("securitySocket()", () => {
  const alert = scoreAlert()

  it("runs the bundled score script with node", () => {
    const run = securitySocket().run as readonly string[]
    expect(run[0]).toBe("node")
    expect(run[1]).toMatch(/scripts[\\/]socket-package-score\.mjs$/)
    expect(run).toHaveLength(2)
  })

  it("fails when the score script terminated abnormally", async () => {
    const result = await securitySocket().policy(makeContext(makeResult({ status: "timed_out" })))
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain("did not run to completion")
  })

  it("passes with zero alerts and leaves an empty registry alone", async () => {
    const result = await securitySocket().policy(makeContext(scriptOutput(okScore([]))))
    expect(result).toEqual({
      outcome: "pass",
      rationale: "0 Socket alert(s) evaluated: all permitted by a complete exception record.",
    })
  })

  it("passes vacuously, saying why, for a skipped or unpublished package", async () => {
    const skipped = await securitySocket().policy(
      makeContext(scriptOutput({ ok: true, data: { skipped: "package is private" } })),
    )
    expect(skipped).toEqual({
      outcome: "pass",
      rationale: "Socket scan skipped: package is private.",
    })
    const unpublished = await securitySocket().policy(
      makeContext(scriptOutput({ ok: true, data: { unpublished: true } })),
    )
    expect(unpublished.outcome).toBe("pass")
    expect(unpublished.rationale).toContain("not published")
  })

  it("fails and scaffolds a blank stub for a new waivable alert with no existing record", async () => {
    const result = await securitySocket().policy(makeContext(scriptOutput(okScore([alert]))))
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain(
      "exception incomplete (missing: justification, alternatives, remediation, method, exceptionType)",
    )
    const written = readRegistry().exceptions
    expect(written).toHaveLength(1)
    expect(written[0]).toMatchObject({
      id: deriveId({ package: "left-pad", version: "1.0.0", type: "unmaintained" }),
      justification: "",
      package: "left-pad",
      packageVersion: "1.0.0",
      type: "unmaintained",
      severity: "middle",
    })
  })

  it("passes a middle-severity waivable alert with a complete exception record", async () => {
    writeRegistry([completeRecord()])
    const result = await securitySocket().policy(makeContext(scriptOutput(okScore([alert]))))
    expect(result).toEqual({
      outcome: "pass",
      rationale: "1 Socket alert(s) evaluated: all permitted by a complete exception record.",
    })
  })

  it("deduplicates the same alert reported by both the self and transitive sections", async () => {
    writeRegistry([completeRecord()])
    const result = await securitySocket().policy(
      makeContext(scriptOutput(okScore([alert, { ...alert, scope: "self" }]))),
    )
    expect(result.rationale).toContain("1 Socket alert(s) evaluated")
  })

  it("passes a low-severity alert missing only alternatives/remediation", async () => {
    writeRegistry([
      completeRecord({
        id: deriveId({ package: "left-pad", version: "1.0.0", type: "nonpermissiveLicense" }),
        type: "nonpermissiveLicense",
        severity: "low",
        alternatives: "",
        remediation: "",
      }),
    ])
    const result = await securitySocket().policy(
      makeContext(
        scriptOutput(
          okScore([
            scoreAlert({ name: "nonpermissiveLicense", severity: "low", category: "license" }),
          ]),
        ),
      ),
    )
    expect(result.outcome).toBe("pass")
  })

  it("fails an incomplete exception record, listing missing fields", async () => {
    writeRegistry([completeRecord({ justification: "" })])
    const result = await securitySocket().policy(makeContext(scriptOutput(okScore([alert]))))
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain("exception incomplete (missing: justification)")
  })

  it("forbids a critical or high severity alert even with a complete exception record", async () => {
    for (const severity of ["critical", "high"]) {
      writeRegistry([completeRecord({ severity })])
      const result = await securitySocket().policy(
        makeContext(scriptOutput(okScore([scoreAlert({ severity })]))),
      )
      expect(result.outcome).toBe("fail")
      expect(result.rationale).toContain("forbidden by policy (above medium severity)")
    }
  })

  it("forbids ANY supply-chain-risk alert, at any severity, even with a complete exception record", async () => {
    for (const severity of ["low", "middle"]) {
      const risky = scoreAlert({ name: "shellAccess", severity, category: "supplyChainRisk" })
      writeRegistry([
        completeRecord({
          id: deriveId({ package: "left-pad", version: "1.0.0", type: "shellAccess" }),
          type: "shellAccess",
          severity,
        }),
      ])
      const result = await securitySocket().policy(makeContext(scriptOutput(okScore([risky]))))
      expect(result.outcome).toBe("fail")
      expect(result.rationale).toContain(
        "- socket:left-pad@1.0.0:shellAccess [" +
          severity +
          "]: forbidden by policy (supply-chain risk -- remove or replace the dependency, or fix the code)",
      )
    }
  })

  it("reports a stale record that matches no current alert", async () => {
    writeRegistry([completeRecord()])
    const result = await securitySocket().policy(makeContext(scriptOutput(okScore([]))))
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain("Socket no longer raises this alert")
  })

  it("treats an unrecognized severity value as unknown, requiring the full field set", async () => {
    writeRegistry([completeRecord({ severity: "unknown", justification: "" })])
    const result = await securitySocket().policy(
      makeContext(scriptOutput(okScore([scoreAlert({ severity: "something-new" })]))),
    )
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain("exception incomplete")
  })

  it("appends a note when the latest published version was scored instead of package.json's", async () => {
    writeRegistry([completeRecord()])
    const result = await securitySocket().policy(
      makeContext(
        scriptOutput(okScore([alert], { requestedVersion: "2.0.0", scoredVersion: "1.9.0" })),
      ),
    )
    expect(result.outcome).toBe("pass")
    expect(result.rationale).toContain(
      "(scored the latest published version 1.9.0; 2.0.0 is not on Socket yet)",
    )
  })

  it("fails with the exact rendered error list when the on-disk registry is malformed", async () => {
    mkdirSync(path.dirname(registryPath()), { recursive: true })
    writeFileSync(
      registryPath(),
      JSON.stringify({ exceptions: [{ id: "not-namespaced", version: 1 }] }),
      "utf8",
    )
    const result = await securitySocket().policy(makeContext(scriptOutput(okScore([]))))
    expect(result).toEqual({
      outcome: "fail",
      rationale: [
        ".repo-contract/exceptions/socket.json failed to load and was left unchanged:",
        '- exceptions[0].id must be a non-empty string beginning with "socket:" (got "not-namespaced").',
        "- exceptions[0].justification must be a string.",
      ].join("\n"),
    })
  })

  it("fails with the persisted-write rationale when the registry path is a symlink", async () => {
    const target = path.join(cwd, "real-registry.json")
    writeFileSync(target, JSON.stringify({ exceptions: [] }), "utf8")
    mkdirSync(path.dirname(registryPath()), { recursive: true })
    symlinkSync(target, registryPath())
    const result = await securitySocket().policy(makeContext(scriptOutput(okScore([alert]))))
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain("is a symlink")
  })

  it("never reconciles the registry when Socket could not run (a failure, not a pass)", async () => {
    writeRegistry([completeRecord()])
    vi.stubEnv("CI", "")
    vi.stubEnv("GITHUB_ACTIONS", "")
    const result = await securitySocket().policy(
      makeContext(scriptOutput({ ok: false, message: "Auth Error", cause: "x" })),
    )
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain("socket login")
    expect(readRegistry().exceptions).toHaveLength(1)
    vi.unstubAllEnvs()
  })
})

describe("isPlainObject()", () => {
  it("is true for a plain object literal", () => {
    expect(isPlainObject({})).toBe(true)
    expect(isPlainObject({ a: 1 })).toBe(true)
  })
  it("is false for null", () => {
    expect(isPlainObject(null)).toBe(false)
  })
  it("is false for an array", () => {
    expect(isPlainObject([1, 2])).toBe(false)
    expect(isPlainObject([])).toBe(false)
  })
  it("is false for non-object primitives", () => {
    expect(isPlainObject("string")).toBe(false)
    expect(isPlainObject(42)).toBe(false)
    expect(isPlainObject(undefined)).toBe(false)
    expect(isPlainObject(true)).toBe(false)
  })
})

describe("safeString()", () => {
  it("returns the string value unchanged", () => {
    expect(safeString("hello")).toBe("hello")
    expect(safeString("")).toBe("")
  })
  it("returns empty string for any non-string value", () => {
    expect(safeString(undefined)).toBe("")
    expect(safeString(null)).toBe("")
    expect(safeString(42)).toBe("")
    expect(safeString({})).toBe("")
  })
})

describe("isAuthError()", () => {
  it("is false for a non-plain-object", () => {
    expect(isAuthError(null)).toBe(false)
    expect(isAuthError("nope")).toBe(false)
    expect(isAuthError([])).toBe(false)
  })
  it("is false when ok is not exactly false", () => {
    expect(isAuthError({ ok: true, message: "Auth Error" })).toBe(false)
    expect(isAuthError({ message: "Auth Error" })).toBe(false)
  })
  it("is false when ok is false but message is unrecognized", () => {
    expect(isAuthError({ ok: false, message: "Something else" })).toBe(false)
    expect(isAuthError({ ok: false })).toBe(false)
  })
  it('is true when ok is false and message is exactly "Auth Error"', () => {
    expect(isAuthError({ ok: false, message: "Auth Error" })).toBe(true)
  })
  it('is true when ok is false and message is exactly "AuthError"', () => {
    expect(isAuthError({ ok: false, message: "AuthError" })).toBe(true)
  })
})

describe("classifyProblem()", () => {
  it("maps Socket's auth envelope to not-authenticated", () => {
    expect(classifyProblem("", { ok: false, message: "Auth Error" })).toBe("not-authenticated")
  })
  it("maps 401 and 403 to token-rejected, 429 to rate-limited, ENOENT to cli-not-installed", () => {
    const withCode = (code: unknown) => ({ ok: false, message: "Socket API error", data: { code } })
    expect(classifyProblem("", withCode(401))).toBe("token-rejected")
    expect(classifyProblem("", withCode(403))).toBe("token-rejected")
    expect(classifyProblem("", withCode(429))).toBe("rate-limited")
    expect(classifyProblem("", withCode("ENOENT"))).toBe("cli-not-installed")
    expect(classifyProblem("", withCode(500))).toBeUndefined()
    expect(classifyProblem("", withCode({}))).toBeUndefined()
    expect(classifyProblem("", { ok: false, data: "x" })).toBeUndefined()
  })
  it("recognizes every network error code in stderr", () => {
    for (const code of ["ENOTFOUND", "ETIMEDOUT", "ECONNREFUSED", "ECONNRESET", "EAI_AGAIN"]) {
      expect(classifyProblem(`getaddrinfo ${code} api.socket.dev`, undefined)).toBe(
        "network-unreachable",
      )
    }
    expect(classifyProblem("a different problem", undefined)).toBeUndefined()
  })
  it("recognizes network wording or codes in a failed envelope's message or cause", () => {
    expect(classifyProblem("", { ok: false, message: "Network down" })).toBe("network-unreachable")
    expect(classifyProblem("", { ok: false, cause: "host unreachable" })).toBe(
      "network-unreachable",
    )
    expect(classifyProblem("", { ok: false, cause: "could not connect" })).toBe(
      "network-unreachable",
    )
    expect(classifyProblem("", { ok: false, cause: "ETIMEDOUT" })).toBe("network-unreachable")
    expect(classifyProblem("", { ok: false, message: "something else" })).toBeUndefined()
  })
  it("ignores a successful envelope and non-objects", () => {
    expect(classifyProblem("", { ok: true, message: "network" })).toBeUndefined()
    expect(classifyProblem("", "network")).toBeUndefined()
    expect(classifyProblem("", null)).toBeUndefined()
  })
})

describe("parseExample()", () => {
  it("splits ecosystem/name@version, including scoped names", () => {
    expect(parseExample("npm/left-pad@1.0.0")).toEqual({ name: "left-pad", version: "1.0.0" })
    expect(parseExample("npm/@scope/pkg@2.3.4")).toEqual({ name: "@scope/pkg", version: "2.3.4" })
    expect(parseExample("plain@1.0.0")).toEqual({ name: "plain", version: "1.0.0" })
  })
  it("rejects anything without a name and a version", () => {
    for (const bad of ["npm/left-pad", "npm/@scope", "npm/left-pad@", "@1.0.0", "", "npm/@1.0.0"]) {
      expect(parseExample(bad)).toBeUndefined()
    }
  })
})

describe("normalizeAlert()", () => {
  const valid = {
    name: "shellAccess",
    severity: "Middle",
    category: "supplyChainRisk",
    example: "npm/cross-spawn@7.0.6",
  }
  it("returns the exact normalized shape, lowercasing a recognized severity", () => {
    expect(normalizeAlert(valid)).toEqual({
      id: "socket:cross-spawn@7.0.6:shellAccess",
      package: "cross-spawn",
      version: "7.0.6",
      type: "shellAccess",
      severity: "middle",
      category: "supplyChainRisk",
    })
  })
  it("returns undefined for a non-object or a missing/empty name or unparseable example", () => {
    expect(normalizeAlert("x")).toBeUndefined()
    expect(normalizeAlert(null)).toBeUndefined()
    expect(normalizeAlert([])).toBeUndefined()
    expect(normalizeAlert({ ...valid, name: undefined })).toBeUndefined()
    expect(normalizeAlert({ ...valid, name: "" })).toBeUndefined()
    expect(normalizeAlert({ ...valid, name: 4 })).toBeUndefined()
    expect(normalizeAlert({ ...valid, example: undefined })).toBeUndefined()
    expect(normalizeAlert({ ...valid, example: 4 })).toBeUndefined()
    expect(normalizeAlert({ ...valid, example: "npm/nope" })).toBeUndefined()
  })
  it("normalizes a non-string or unrecognized severity to unknown", () => {
    expect(normalizeAlert({ ...valid, severity: 3 })?.severity).toBe("unknown")
    expect(normalizeAlert({ ...valid, severity: "wat" })?.severity).toBe("unknown")
    expect(normalizeAlert({ ...valid, severity: undefined })?.severity).toBe("unknown")
  })
  it("uses an empty category when Socket sent none", () => {
    expect(normalizeAlert({ ...valid, category: undefined })?.category).toBe("")
    expect(normalizeAlert({ ...valid, category: 7 })?.category).toBe("")
  })
})

describe("deriveSocketExceptionId()", () => {
  it("joins package/packageVersion/type into the socket: id", () => {
    expect(
      deriveSocketExceptionId({
        package: "left-pad",
        packageVersion: "1.0.0",
        type: "unmaintained",
      }),
    ).toBe("socket:left-pad@1.0.0:unmaintained")
  })
})

describe("createSocketStub()", () => {
  it("returns a fully blank stub with the alert's identity fields mapped in", () => {
    const alert = {
      id: "socket:left-pad@1.0.0:unmaintained",
      package: "left-pad",
      version: "1.0.0",
      type: "unmaintained",
      severity: "middle" as const,
      category: "maintenance",
    }
    expect(createSocketStub(alert, "socket:left-pad@1.0.0:unmaintained")).toEqual({
      id: "socket:left-pad@1.0.0:unmaintained",
      version: 1,
      justification: "",
      alternatives: "",
      remediation: "",
      method: "",
      exceptionType: "",
      package: "left-pad",
      packageVersion: "1.0.0",
      type: "unmaintained",
      severity: "middle",
    })
  })
})

describe("isValidOptionalEnumField()", () => {
  it("accepts the empty string without pushing an error", () => {
    const errors: string[] = []
    expect(isValidOptionalEnumField("", "field", ["a", "b"], errors)).toBe(true)
    expect(errors).toEqual([])
  })
  it("accepts a value in the allowed list without pushing an error", () => {
    const errors: string[] = []
    expect(isValidOptionalEnumField("a", "field", ["a", "b"], errors)).toBe(true)
    expect(errors).toEqual([])
  })
  it("rejects a non-string value and pushes the exact error message", () => {
    const errors: string[] = []
    expect(isValidOptionalEnumField(42, "field", ["a", "b"], errors)).toBe(false)
    expect(errors).toEqual(['field must be "" or one of "a", "b" (got 42).'])
  })
  it("rejects a string not in the allowed list and pushes the exact error message", () => {
    const errors: string[] = []
    expect(isValidOptionalEnumField("c", "field", ["a", "b"], errors)).toBe(false)
    expect(errors).toEqual(['field must be "" or one of "a", "b" (got "c").'])
  })
})

describe("SOCKET_EXCEPTION_SCHEMA.validateRecord()", () => {
  const core = { id: "socket:left-pad@1.0.0:unmaintained", version: 1 as const, justification: "" }
  function validRaw(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      alternatives: "",
      remediation: "",
      method: "",
      exceptionType: "",
      package: "left-pad",
      packageVersion: "1.0.0",
      type: "unmaintained",
      severity: "middle",
      ...overrides,
    }
  }

  it("builds the full record when every field is valid and the id matches", () => {
    const errors: string[] = []
    const record = SOCKET_EXCEPTION_SCHEMA.validateRecord(core, validRaw(), 0, errors)
    expect(errors).toEqual([])
    expect(record).toEqual({
      id: "socket:left-pad@1.0.0:unmaintained",
      version: 1,
      justification: "",
      alternatives: "",
      remediation: "",
      method: "",
      exceptionType: "",
      package: "left-pad",
      packageVersion: "1.0.0",
      type: "unmaintained",
      severity: "middle",
    })
  })
  it("returns undefined when the security fields are invalid", () => {
    const errors: string[] = []
    const record = SOCKET_EXCEPTION_SCHEMA.validateRecord(
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
    const record = SOCKET_EXCEPTION_SCHEMA.validateRecord(
      core,
      validRaw({ package: "" }),
      0,
      errors,
    )
    expect(record).toBeUndefined()
    expect(errors).toContain("exceptions[0].package must be a non-empty string.")
  })
  it("returns undefined when packageVersion is missing/empty", () => {
    const errors: string[] = []
    const record = SOCKET_EXCEPTION_SCHEMA.validateRecord(
      core,
      validRaw({ packageVersion: "" }),
      0,
      errors,
    )
    expect(record).toBeUndefined()
    expect(errors).toContain("exceptions[0].packageVersion must be a non-empty string.")
  })
  it("returns undefined when type is missing/empty", () => {
    const errors: string[] = []
    const record = SOCKET_EXCEPTION_SCHEMA.validateRecord(core, validRaw({ type: "" }), 0, errors)
    expect(record).toBeUndefined()
    expect(errors).toContain("exceptions[0].type must be a non-empty string.")
  })
  it("returns undefined when severity is not a recognized value", () => {
    const errors: string[] = []
    const record = SOCKET_EXCEPTION_SCHEMA.validateRecord(
      core,
      validRaw({ severity: "extreme" }),
      0,
      errors,
    )
    expect(record).toBeUndefined()
    expect(errors).toContain(
      'exceptions[0].severity must be "" or one of "critical", "high", "middle", "low", "unknown" (got "extreme").',
    )
  })
  it("returns undefined and reports a mismatched id, without ever double-reporting field errors", () => {
    const errors: string[] = []
    const mismatchedCore = { ...core, id: "socket:wrong@1.0.0:unmaintained" }
    const record = SOCKET_EXCEPTION_SCHEMA.validateRecord(mismatchedCore, validRaw(), 0, errors)
    expect(record).toBeUndefined()
    expect(errors).toEqual([
      'exceptions[0].id "socket:wrong@1.0.0:unmaintained" does not match the id derived from its own package/packageVersion/type ("socket:left-pad@1.0.0:unmaintained").',
    ])
  })
})

describe("evaluateAlert()", () => {
  const alert = {
    id: "socket:left-pad@1.0.0:unmaintained",
    package: "left-pad",
    version: "1.0.0",
    type: "unmaintained",
    severity: "middle" as const,
    category: "maintenance",
  }
  const blankRecord = {
    id: alert.id,
    version: 1 as const,
    justification: "",
    alternatives: "",
    remediation: "",
    method: "" as const,
    exceptionType: "" as const,
    package: "left-pad",
    packageVersion: "1.0.0",
    type: "unmaintained",
    severity: "middle" as const,
  }
  it("is unmatched when there is no record", () => {
    expect(evaluateAlert(alert, undefined)).toEqual({ verdict: "unmatched", missing: [] })
  })
  it("is forbidden for critical severity even with a complete record", () => {
    expect(
      evaluateAlert({ ...alert, severity: "critical" }, { ...blankRecord, severity: "critical" }),
    ).toEqual({
      verdict: "forbidden",
      missing: [],
    })
  })
  it("is forbidden for high severity even with a complete record", () => {
    expect(
      evaluateAlert({ ...alert, severity: "high" }, { ...blankRecord, severity: "high" }),
    ).toEqual({
      verdict: "forbidden",
      missing: [],
    })
  })
  it("is insufficient for middle severity missing required fields, listing exactly what's missing", () => {
    const record = {
      id: alert.id,
      version: 1 as const,
      justification: "",
      alternatives: "",
      remediation: "",
      method: "" as const,
      exceptionType: "" as const,
      package: "left-pad",
      packageVersion: "1.0.0",
      type: "unmaintained",
      severity: "middle" as const,
    }
    expect(evaluateAlert(alert, record)).toEqual({
      verdict: "insufficient",
      missing: ["justification", "alternatives", "remediation", "method", "exceptionType"],
    })
  })
  it("is permitted for low severity missing only alternatives/remediation", () => {
    const record = {
      id: alert.id,
      version: 1 as const,
      justification: "ok",
      alternatives: "",
      remediation: "",
      method: "independent-human-review" as const,
      exceptionType: "accepted-risk" as const,
      package: "left-pad",
      packageVersion: "1.0.0",
      type: "unmaintained",
      severity: "low" as const,
    }
    expect(evaluateAlert({ ...alert, severity: "low" }, record)).toEqual({
      verdict: "permitted",
      missing: [],
    })
  })
  it("treats unknown severity the same as the full requirement set", () => {
    expect(evaluateAlert({ ...alert, severity: "unknown" }, undefined)).toEqual({
      verdict: "unmatched",
      missing: [],
    })
  })
  it("is forbidden for a supply-chain-risk alert at any severity, even with a complete record", () => {
    for (const severity of ["low", "middle"] as const) {
      const risky = { ...alert, severity, category: "supplyChainRisk" }
      const complete = {
        ...blankRecord,
        severity,
        justification: "j",
        alternatives: "a",
        remediation: "r",
        method: "independent-human-review" as const,
        exceptionType: "accepted-risk" as const,
      }
      expect(evaluateAlert(risky, complete).verdict).toBe("forbidden")
    }
  })
  it("applies only the severity rules when the alert has no category", () => {
    const uncategorized = { ...alert, category: "" }
    expect(evaluateAlert(uncategorized, undefined)).toEqual({ verdict: "unmatched", missing: [] })
  })
})

describe("interpretSocketRun()", () => {
  const ok = (body: unknown, overrides: Parameters<typeof makeResult>[0] = {}) =>
    interpretSocketRun(scriptOutput(body, overrides), LOCAL_ENV)

  it("fails on abnormal termination with the exact tool-labeled rationale", () => {
    expect(interpretSocketRun(makeResult({ status: "timed_out" }), LOCAL_ENV)).toEqual({
      kind: "fail",
      rationale: "socket-package-score did not run to completion (status: timed_out).",
    })
  })

  it("fails with the no-JSON rationale for unparseable stdout, naming the exit code", () => {
    expect(interpretSocketRun(makeResult({ stdout: "nope", exitCode: 3 }), LOCAL_ENV)).toEqual({
      kind: "fail",
      rationale: "The Socket score script produced no parseable JSON output (exit code 3).",
    })
  })

  it("tolerates whitespace around the JSON", () => {
    expect(
      interpretSocketRun(
        makeResult({ stdout: '\n {"ok":true,"data":{"skipped":"x"}} \n' }),
        LOCAL_ENV,
      ).kind,
    ).toBe("pass")
  })

  it("gives network guidance when stdout is empty and stderr shows a network error", () => {
    const outcome = interpretSocketRun(
      makeResult({ stdout: "", stderr: "getaddrinfo ENOTFOUND api.socket.dev" }),
      LOCAL_ENV,
    )
    expect(outcome.kind).toBe("fail")
    expect(outcome.kind === "fail" && outcome.rationale).toContain("could not be reached")
  })

  it("fails when there is no recognized ok field (object without it, or not an object)", () => {
    const expected = {
      kind: "fail",
      rationale: 'The Socket score script produced JSON with no recognized "ok" boolean field.',
    }
    expect(ok({ nope: 1 })).toEqual(expected)
    expect(ok({ ok: "yes" })).toEqual(expected)
    expect(ok([])).toEqual(expected)
  })

  it("gives local, cause-specific steps for each problem", () => {
    const fail = (body: unknown, env = LOCAL_ENV) => {
      const outcome = interpretSocketRun(scriptOutput(body), env)
      return outcome.kind === "fail" ? outcome.rationale : ""
    }
    expect(fail({ ok: false, message: "Auth Error" })).toContain("you are not signed in to Socket")
    expect(fail({ ok: false, message: "Auth Error" })).toContain("1. Sign in: `socket login`")
    expect(fail({ ok: false, data: { code: 401 } })).toContain("rejected the API token")
    expect(fail({ ok: false, data: { code: 429 } })).toContain("rate-limited")
    expect(fail({ ok: false, data: { code: "ENOENT" } })).toContain("`socket` CLI is not installed")
  })

  it("gives CI-specific steps (secret setup) instead of local sign-in when running in CI", () => {
    const outcome = interpretSocketRun(scriptOutput({ ok: false, message: "Auth Error" }), CI_ENV)
    const rationale = outcome.kind === "fail" ? outcome.rationale : ""
    expect(rationale).toContain("no Socket API token is available to this CI run")
    expect(rationale).toContain("SOCKET_SECURITY_API_KEY")
    expect(rationale).not.toContain("socket login")
  })

  it("fails with Socket's own message and cause for an unclassified failure", () => {
    expect(ok({ ok: false, message: "Boom", cause: "because" })).toEqual({
      kind: "fail",
      rationale: "security-socket scan failed: Boom: because.",
    })
    expect(ok({ ok: false, message: "Boom" })).toEqual({
      kind: "fail",
      rationale: "security-socket scan failed: Boom.",
    })
    expect(ok({ ok: false })).toEqual({
      kind: "fail",
      rationale: "security-socket scan failed: unrecognized failure.",
    })
  })

  it("fails when success has no data object", () => {
    expect(ok({ ok: true })).toEqual({
      kind: "fail",
      rationale: "The Socket score script reported success without a data object.",
    })
    expect(ok({ ok: true, data: [] }).kind).toBe("fail")
  })

  it("passes, saying why, for skipped and unpublished packages", () => {
    expect(ok({ ok: true, data: { skipped: "reason" } })).toEqual({
      kind: "pass",
      rationale: "Socket scan skipped: reason.",
    })
    const unpublished = ok({ ok: true, data: { unpublished: true } })
    expect(unpublished.kind).toBe("pass")
  })

  it("fails when alerts is not an array", () => {
    expect(ok({ ok: true, data: { alerts: {} } })).toEqual({
      kind: "fail",
      rationale: 'The Socket score script\'s "alerts" is not an array.',
    })
    expect(ok({ ok: true, data: {} }).kind).toBe("fail")
  })

  it("fails at the correct index when an alert entry is malformed", () => {
    expect(ok(okScore([scoreAlert(), scoreAlert(), { name: "x" }]))).toEqual({
      kind: "fail",
      rationale:
        "The Socket score script reported an alert (index 2) missing its name or example package@version.",
    })
  })

  it("returns the deduplicated alert list with no note when versions agree", () => {
    const outcome = ok(okScore([scoreAlert(), scoreAlert({ scope: "self" })]))
    expect(outcome).toEqual({
      kind: "ok",
      alerts: [
        {
          id: "socket:left-pad@1.0.0:unmaintained",
          package: "left-pad",
          version: "1.0.0",
          type: "unmaintained",
          severity: "middle",
          category: "maintenance",
        },
      ],
      note: "",
    })
  })

  it("adds a note only when both versions are known and differ", () => {
    const note = (extra: Record<string, unknown>) => {
      const outcome = ok(okScore([], extra))
      return outcome.kind === "ok" ? outcome.note : "n/a"
    }
    expect(note({ requestedVersion: "2.0.0", scoredVersion: "1.0.0" })).toBe(
      " (scored the latest published version 1.0.0; 2.0.0 is not on Socket yet)",
    )
    expect(note({ requestedVersion: "", scoredVersion: "1.0.0" })).toBe("")
    expect(note({ requestedVersion: "2.0.0", scoredVersion: "" })).toBe("")
    expect(note({ requestedVersion: "1.0.0", scoredVersion: "1.0.0" })).toBe("")
  })
})

describe("evaluateFinalVerdict()", () => {
  const alert = {
    id: "socket:left-pad@1.0.0:unmaintained",
    package: "left-pad",
    version: "1.0.0",
    type: "unmaintained",
    severity: "middle" as const,
    category: "maintenance",
  }
  function registryWith(
    overrides: Partial<{
      activeRecords: readonly unknown[]
      staleRecords: readonly unknown[]
      newStubIds: readonly string[]
    }> = {},
  ) {
    return {
      activeRecords: [],
      staleRecords: [],
      newStubIds: [],
      ...overrides,
    } as never
  }

  it("passes with the exact rationale and no suffix when there are no offenders/stale records/stubs", () => {
    const result = evaluateFinalVerdict([], registryWith())
    expect(result).toEqual({
      outcome: "pass",
      rationale: "0 Socket alert(s) evaluated: all permitted by a complete exception record.",
    })
  })
  it("passes with the exact stub-count suffix when new stubs were scaffolded", () => {
    const result = evaluateFinalVerdict([], registryWith({ newStubIds: ["socket:a@1:b"] }))
    expect(result).toEqual({
      outcome: "pass",
      rationale:
        "0 Socket alert(s) evaluated: all permitted by a complete exception record. (1 new record(s) scaffolded blank in .repo-contract/exceptions/socket.json)",
    })
  })
  it("fails listing a forbidden offender with the exact line format", () => {
    const criticalRecord = {
      id: alert.id,
      version: 1 as const,
      justification: "j",
      alternatives: "",
      remediation: "",
      method: "independent-human-review" as const,
      exceptionType: "accepted-risk" as const,
      package: "left-pad",
      packageVersion: "1.0.0",
      type: "unmaintained",
      severity: "critical" as const,
    }
    const result = evaluateFinalVerdict(
      [{ ...alert, severity: "critical" }],
      registryWith({ activeRecords: [criticalRecord] }),
    )
    expect(result).toEqual({
      outcome: "fail",
      rationale: [
        "1 Socket alert(s) or stale record(s) need attention:",
        "- socket:left-pad@1.0.0:unmaintained [critical]: forbidden by policy (above medium severity)",
      ].join("\n"),
    })
  })
  it("fails listing an unmatched offender with the exact line format", () => {
    const result = evaluateFinalVerdict([alert], registryWith())
    expect(result).toEqual({
      outcome: "fail",
      rationale: [
        "1 Socket alert(s) or stale record(s) need attention:",
        "- socket:left-pad@1.0.0:unmaintained [middle]: no reconciled exception record (registry integrity failure)",
      ].join("\n"),
    })
  })
  it("fails listing an insufficient offender with its exact missing-fields list", () => {
    const record = {
      id: alert.id,
      version: 1 as const,
      justification: "",
      alternatives: "",
      remediation: "",
      method: "" as const,
      exceptionType: "" as const,
      package: "left-pad",
      packageVersion: "1.0.0",
      type: "unmaintained",
      severity: "middle" as const,
    }
    const result = evaluateFinalVerdict([alert], registryWith({ activeRecords: [record] }))
    expect(result).toEqual({
      outcome: "fail",
      rationale: [
        "1 Socket alert(s) or stale record(s) need attention:",
        "- socket:left-pad@1.0.0:unmaintained [middle]: exception incomplete (missing: justification, alternatives, remediation, method, exceptionType)",
      ].join("\n"),
    })
  })
  it("fails listing a stale record with the exact line format, combining counts with offenders", () => {
    const staleRecord = {
      id: "socket:old@1.0.0:unmaintained",
      version: 1 as const,
      justification: "j",
      alternatives: "",
      remediation: "",
      method: "independent-human-review" as const,
      exceptionType: "accepted-risk" as const,
      package: "old",
      packageVersion: "1.0.0",
      type: "unmaintained",
      severity: "middle" as const,
    }
    const criticalRecord = {
      id: alert.id,
      version: 1 as const,
      justification: "j",
      alternatives: "",
      remediation: "",
      method: "independent-human-review" as const,
      exceptionType: "accepted-risk" as const,
      package: "left-pad",
      packageVersion: "1.0.0",
      type: "unmaintained",
      severity: "critical" as const,
    }
    const result = evaluateFinalVerdict(
      [{ ...alert, severity: "critical" }],
      registryWith({ activeRecords: [criticalRecord], staleRecords: [staleRecord] }),
    )
    expect(result).toEqual({
      outcome: "fail",
      rationale: [
        "2 Socket alert(s) or stale record(s) need attention:",
        "- socket:left-pad@1.0.0:unmaintained [critical]: forbidden by policy (above medium severity)",
        '- Stale exception in .repo-contract/exceptions/socket.json: "socket:old@1.0.0:unmaintained" -- Socket no longer raises this alert; delete this entry.',
      ].join("\n"),
    })
  })
})
