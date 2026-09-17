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
  isNetworkUnreachable,
  isPlainObject,
  isValidOptionalEnumField,
  normalizeAlert,
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
  rmSync(cwd, { recursive: true, force: true })
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

function ciOutput(
  body: unknown,
  overrides: Parameters<typeof makeResult>[0] = {},
): ReturnType<typeof makeResult> {
  return makeResult({ stdout: JSON.stringify(body), ...overrides })
}

function completeRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const base = {
    id: deriveId({ package: "left-pad", version: "1.0.0", type: "envVars" }),
    version: 1,
    justification: "Reads PORT only, matches documented behavior.",
    alternatives: "None -- transitive, not a direct choice.",
    remediation: "None planned.",
    method: "independent-human-review",
    exceptionType: "accepted-risk",
    package: "left-pad",
    packageVersion: "1.0.0",
    type: "envVars",
    severity: "middle",
  }
  return { ...base, ...overrides }
}

describe("securitySocket()", () => {
  it("warns when the socket CLI is not installed", async () => {
    const check = securitySocket()
    const result = await check.policy(
      makeContext(
        makeResult({ status: "spawn_error", spawnErrorCode: "ENOENT", stdout: "", exitCode: null }),
      ),
    )
    expect(result).toEqual({
      outcome: "warn",
      rationale:
        "security-socket did not run (cli-not-installed) -- alerts were not evaluated. Install and authenticate @socketsecurity/cli to enable real enforcement.",
    })
  })

  it("fails when the socket process terminated abnormally", async () => {
    const check = securitySocket()
    const result = await check.policy(makeContext(makeResult({ status: "timed_out" })))
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain("did not run to completion")
  })

  it("fails when stdout is not parseable JSON", async () => {
    const check = securitySocket()
    const result = await check.policy(makeContext(makeResult({ stdout: "not json" })))
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain("no parseable JSON output")
  })

  it("warns on Socket's own not-authenticated envelope", async () => {
    const check = securitySocket()
    const result = await check.policy(
      makeContext(
        ciOutput({ ok: false, message: "Auth Error", cause: "Run `socket login` first." }),
      ),
    )
    expect(result.outcome).toBe("warn")
    expect(result.rationale).toContain("not-authenticated")
  })

  it("notes existing (unreconciled) exception records when unauthenticated", async () => {
    writeRegistry([completeRecord()])
    const check = securitySocket()
    const result = await check.policy(
      makeContext(
        ciOutput({ ok: false, message: "Auth Error", cause: "Run `socket login` first." }),
      ),
    )
    expect(result.outcome).toBe("warn")
    expect(result.rationale).toContain("1 exception record(s)")
    // Not reconciled -- the file on disk is untouched.
    expect(readRegistry().exceptions).toHaveLength(1)
  })

  it("warns on a recognized network-unreachable failure", async () => {
    const check = securitySocket()
    const result = await check.policy(
      makeContext(makeResult({ stdout: "", stderr: "getaddrinfo ENOTFOUND registry.socket.dev" })),
    )
    expect(result.outcome).toBe("warn")
    expect(result.rationale).toContain("network-unreachable")
  })

  it("fails when the report has no recognized ok field", async () => {
    const check = securitySocket()
    const result = await check.policy(makeContext(ciOutput({ nothing: "recognized" })))
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain('no recognized "ok" boolean field')
  })

  it("fails when ok is false with an unrecognized message", async () => {
    const check = securitySocket()
    const result = await check.policy(
      makeContext(ciOutput({ ok: false, message: "Something else broke" })),
    )
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toBe("security-socket scan failed: Something else broke")
  })

  it('passes with zero alerts when alerts is an empty object -- the CLI\'s real shape for a clean scan (confirmed directly against a real authenticated run: `{ "alerts": {} }`, never `[]`)', async () => {
    const check = securitySocket()
    const result = await check.policy(
      makeContext(ciOutput({ ok: true, healthy: true, alerts: {} })),
    )
    expect(result.outcome).toBe("pass")
    expect(result.rationale).toContain("0 Socket alert(s) evaluated")
  })

  it("fails when ok is true but alerts is a non-empty, unparseable shape (the CLI's real nested-map structure this check doesn't parse yet)", async () => {
    const check = securitySocket()
    const result = await check.policy(
      makeContext(ciOutput({ ok: true, alerts: { policyKey: { pkg: { hashery: {} } } } })),
    )
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain("real nested-object shape this check does not yet parse")
  })

  it("fails when ok is true but alerts is neither an array nor an object", async () => {
    const check = securitySocket()
    const result = await check.policy(makeContext(ciOutput({ ok: true, alerts: "nope" })))
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain("real nested-object shape this check does not yet parse")
  })

  it("fails when an alert entry is missing a required field", async () => {
    const check = securitySocket()
    const result = await check.policy(
      makeContext(ciOutput({ ok: true, alerts: [{ package: "left-pad" }] })),
    )
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain("missing a required field")
  })

  it("passes with zero alerts and leaves an empty registry alone", async () => {
    const check = securitySocket()
    const result = await check.policy(makeContext(ciOutput({ ok: true, alerts: [] })))
    expect(result).toEqual({
      outcome: "pass",
      rationale: "0 Socket alert(s) evaluated: all permitted by a complete exception record.",
    })
  })

  it("also reads alerts nested under data.alerts", async () => {
    const check = securitySocket()
    const result = await check.policy(makeContext(ciOutput({ ok: true, data: { alerts: [] } })))
    expect(result.outcome).toBe("pass")
  })

  it("fails and scaffolds a blank stub for a new alert with no existing record", async () => {
    const check = securitySocket()
    const alert = { package: "left-pad", version: "1.0.0", type: "envVars", severity: "middle" }
    const result = await check.policy(makeContext(ciOutput({ ok: true, alerts: [alert] })))
    expect(result.outcome).toBe("fail")
    // The stub is scaffolded and reconciled as this alert's active record, then evaluated like
    // any other -- blank, so every requirement is reported missing (never "unmatched": that
    // verdict is only reachable if the reconcile<->policy bijection itself breaks).
    expect(result.rationale).toContain(
      "exception incomplete (missing: justification, alternatives, remediation, method, exceptionType)",
    )

    const written = readRegistry().exceptions
    expect(written).toHaveLength(1)
    expect(written[0]).toMatchObject({
      id: deriveId(alert),
      justification: "",
      package: "left-pad",
      packageVersion: "1.0.0",
      type: "envVars",
      severity: "middle",
    })
  })

  it("passes a middle-severity alert with a complete exception record", async () => {
    writeRegistry([completeRecord()])
    const check = securitySocket()
    const alert = { package: "left-pad", version: "1.0.0", type: "envVars", severity: "middle" }
    const result = await check.policy(makeContext(ciOutput({ ok: true, alerts: [alert] })))
    expect(result).toEqual({
      outcome: "pass",
      rationale: "1 Socket alert(s) evaluated: all permitted by a complete exception record.",
    })
  })

  it("passes a low-severity alert missing only alternatives/remediation", async () => {
    writeRegistry([
      completeRecord({
        id: deriveId({ package: "left-pad", version: "1.0.0", type: "filesystem" }),
        type: "filesystem",
        severity: "low",
        alternatives: "",
        remediation: "",
      }),
    ])
    const check = securitySocket()
    const alert = { package: "left-pad", version: "1.0.0", type: "filesystem", severity: "low" }
    const result = await check.policy(makeContext(ciOutput({ ok: true, alerts: [alert] })))
    expect(result.outcome).toBe("pass")
  })

  it("fails an incomplete exception record, listing missing fields", async () => {
    writeRegistry([completeRecord({ justification: "" })])
    const check = securitySocket()
    const alert = { package: "left-pad", version: "1.0.0", type: "envVars", severity: "middle" }
    const result = await check.policy(makeContext(ciOutput({ ok: true, alerts: [alert] })))
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain("exception incomplete (missing: justification)")
  })

  it("forbids a critical-severity alert even with an otherwise-complete exception record", async () => {
    writeRegistry([completeRecord({ severity: "critical" })])
    const check = securitySocket()
    const alert = { package: "left-pad", version: "1.0.0", type: "envVars", severity: "critical" }
    const result = await check.policy(makeContext(ciOutput({ ok: true, alerts: [alert] })))
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain("forbidden by policy (above medium severity)")
  })

  it("forbids a high-severity alert the same way", async () => {
    writeRegistry([completeRecord({ severity: "high" })])
    const check = securitySocket()
    const alert = { package: "left-pad", version: "1.0.0", type: "envVars", severity: "high" }
    const result = await check.policy(makeContext(ciOutput({ ok: true, alerts: [alert] })))
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain("forbidden by policy")
  })

  it("reports a stale record that matches no current alert, and removes it from the rewritten registry as inactive but still listed", async () => {
    writeRegistry([completeRecord()])
    const check = securitySocket()
    const result = await check.policy(makeContext(ciOutput({ ok: true, alerts: [] })))
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain("Socket no longer raises this alert")
  })

  it("treats an unrecognized severity value as unknown, requiring the full field set", async () => {
    writeRegistry([completeRecord({ severity: "unknown", justification: "" })])
    const check = securitySocket()
    const alert = {
      package: "left-pad",
      version: "1.0.0",
      type: "envVars",
      severity: "something-new",
    }
    const result = await check.policy(makeContext(ciOutput({ ok: true, alerts: [alert] })))
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain("exception incomplete")
  })

  it("fails with the exact rendered error list when the on-disk registry is malformed", async () => {
    mkdirSync(path.dirname(registryPath()), { recursive: true })
    writeFileSync(
      registryPath(),
      JSON.stringify({ exceptions: [{ id: "not-namespaced", version: 1 }] }),
      "utf8",
    )
    const check = securitySocket()
    const result = await check.policy(makeContext(ciOutput({ ok: true, alerts: [] })))
    expect(result).toEqual({
      outcome: "fail",
      rationale: [
        ".repo-contract/exceptions/socket.json failed to load and was left unchanged:",
        '- exceptions[0].id must be a non-empty string beginning with "socket:" (got "not-namespaced").',
        "- exceptions[0].justification must be a string.",
      ].join("\n"),
    })
  })

  it("runs the exact socket CLI invocation", () => {
    expect(securitySocket().run).toEqual(["socket", "ci", "--json", "--no-banner", "--no-spinner"])
  })

  it("fails with the persisted-write rationale when the registry path is a symlink", async () => {
    const target = path.join(cwd, "real-registry.json")
    writeFileSync(target, JSON.stringify({ exceptions: [] }), "utf8")
    mkdirSync(path.dirname(registryPath()), { recursive: true })
    symlinkSync(target, registryPath())
    const check = securitySocket()
    const alert = { package: "left-pad", version: "1.0.0", type: "envVars", severity: "middle" }
    const result = await check.policy(makeContext(ciOutput({ ok: true, alerts: [alert] })))
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain("is a symlink")
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

describe("isNetworkUnreachable()", () => {
  it("is true when stderr contains a recognized network error code", () => {
    expect(isNetworkUnreachable("getaddrinfo ENOTFOUND registry.socket.dev", undefined)).toBe(true)
    expect(isNetworkUnreachable("connect ETIMEDOUT 1.2.3.4:443", undefined)).toBe(true)
    expect(isNetworkUnreachable("connect ECONNREFUSED 127.0.0.1:443", undefined)).toBe(true)
    expect(isNetworkUnreachable("read ECONNRESET", undefined)).toBe(true)
  })
  it("is false when stderr contains no recognized code and parsed is not a not-ok object", () => {
    expect(isNetworkUnreachable("", undefined)).toBe(false)
    expect(isNetworkUnreachable("some other stderr text", { ok: true })).toBe(false)
    expect(isNetworkUnreachable("", "not an object")).toBe(false)
  })
  it("is false when parsed is not-ok but message/cause/data mention nothing network-related", () => {
    expect(
      isNetworkUnreachable("", { ok: false, message: "boom", cause: "bad", data: "oops" }),
    ).toBe(false)
  })
  it("is true when the not-ok message mentions network", () => {
    expect(isNetworkUnreachable("", { ok: false, message: "network error" })).toBe(true)
  })
  it("is true when the not-ok cause mentions unreachable", () => {
    expect(isNetworkUnreachable("", { ok: false, cause: "host unreachable" })).toBe(true)
  })
  it("is true when the not-ok data mentions could not connect", () => {
    expect(isNetworkUnreachable("", { ok: false, data: "could not connect to host" })).toBe(true)
  })
  it("is false at the final fallback when parsed is a plain object with ok true", () => {
    expect(isNetworkUnreachable("", { ok: true, message: "network" })).toBe(false)
  })
})

describe("normalizeAlert()", () => {
  it("returns undefined for a non-plain-object", () => {
    expect(normalizeAlert(null)).toBeUndefined()
    expect(normalizeAlert("nope")).toBeUndefined()
    expect(normalizeAlert([])).toBeUndefined()
  })
  it("falls back to name when package is absent", () => {
    const result = normalizeAlert({ name: "left-pad", version: "1.0.0", type: "envVars" })
    expect(result?.package).toBe("left-pad")
  })
  it("prefers package over name when both are present", () => {
    const result = normalizeAlert({
      package: "left-pad",
      name: "wrong-name",
      version: "1.0.0",
      type: "envVars",
    })
    expect(result?.package).toBe("left-pad")
  })
  it("returns undefined when package/name are both absent", () => {
    expect(normalizeAlert({ version: "1.0.0", type: "envVars" })).toBeUndefined()
  })
  it("returns undefined when package is an empty string", () => {
    expect(normalizeAlert({ package: "", version: "1.0.0", type: "envVars" })).toBeUndefined()
  })
  it("returns undefined when version is missing, non-string, or empty", () => {
    expect(normalizeAlert({ package: "left-pad", type: "envVars" })).toBeUndefined()
    expect(normalizeAlert({ package: "left-pad", version: 1, type: "envVars" })).toBeUndefined()
    expect(normalizeAlert({ package: "left-pad", version: "", type: "envVars" })).toBeUndefined()
  })
  it("returns undefined when type is missing, non-string, or empty", () => {
    expect(normalizeAlert({ package: "left-pad", version: "1.0.0" })).toBeUndefined()
    expect(normalizeAlert({ package: "left-pad", version: "1.0.0", type: 1 })).toBeUndefined()
    expect(normalizeAlert({ package: "left-pad", version: "1.0.0", type: "" })).toBeUndefined()
  })
  it("normalizes a non-string severity to unknown", () => {
    const result = normalizeAlert({ package: "left-pad", version: "1.0.0", type: "envVars" })
    expect(result?.severity).toBe("unknown")
  })
  it("normalizes an unrecognized severity string to unknown", () => {
    const result = normalizeAlert({
      package: "left-pad",
      version: "1.0.0",
      type: "envVars",
      severity: "extreme",
    })
    expect(result?.severity).toBe("unknown")
  })
  it("lowercases a recognized severity value", () => {
    const result = normalizeAlert({
      package: "left-pad",
      version: "1.0.0",
      type: "envVars",
      severity: "HIGH",
    })
    expect(result?.severity).toBe("high")
  })
  it("returns the exact normalized shape for a fully valid alert", () => {
    const result = normalizeAlert({
      package: "left-pad",
      version: "1.0.0",
      type: "envVars",
      severity: "middle",
    })
    expect(result).toEqual({
      id: "socket:left-pad@1.0.0:envVars",
      package: "left-pad",
      version: "1.0.0",
      type: "envVars",
      severity: "middle",
    })
  })
})

describe("deriveSocketExceptionId()", () => {
  it("joins package/packageVersion/type into the socket: id", () => {
    expect(
      deriveSocketExceptionId({ package: "left-pad", packageVersion: "1.0.0", type: "envVars" }),
    ).toBe("socket:left-pad@1.0.0:envVars")
  })
})

describe("createSocketStub()", () => {
  it("returns a fully blank stub with the alert's identity fields mapped in", () => {
    const alert = {
      id: "socket:left-pad@1.0.0:envVars",
      package: "left-pad",
      version: "1.0.0",
      type: "envVars",
      severity: "middle" as const,
    }
    expect(createSocketStub(alert, "socket:left-pad@1.0.0:envVars")).toEqual({
      id: "socket:left-pad@1.0.0:envVars",
      version: 1,
      justification: "",
      alternatives: "",
      remediation: "",
      method: "",
      exceptionType: "",
      package: "left-pad",
      packageVersion: "1.0.0",
      type: "envVars",
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
  const core = { id: "socket:left-pad@1.0.0:envVars", version: 1 as const, justification: "" }
  function validRaw(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      alternatives: "",
      remediation: "",
      method: "",
      exceptionType: "",
      package: "left-pad",
      packageVersion: "1.0.0",
      type: "envVars",
      severity: "middle",
      ...overrides,
    }
  }

  it("builds the full record when every field is valid and the id matches", () => {
    const errors: string[] = []
    const record = SOCKET_EXCEPTION_SCHEMA.validateRecord(core, validRaw(), 0, errors)
    expect(errors).toEqual([])
    expect(record).toEqual({
      id: "socket:left-pad@1.0.0:envVars",
      version: 1,
      justification: "",
      alternatives: "",
      remediation: "",
      method: "",
      exceptionType: "",
      package: "left-pad",
      packageVersion: "1.0.0",
      type: "envVars",
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
    const mismatchedCore = { ...core, id: "socket:wrong@1.0.0:envVars" }
    const record = SOCKET_EXCEPTION_SCHEMA.validateRecord(mismatchedCore, validRaw(), 0, errors)
    expect(record).toBeUndefined()
    expect(errors).toEqual([
      'exceptions[0].id "socket:wrong@1.0.0:envVars" does not match the id derived from its own package/packageVersion/type ("socket:left-pad@1.0.0:envVars").',
    ])
  })
})

describe("evaluateAlert()", () => {
  const alert = {
    id: "socket:left-pad@1.0.0:envVars",
    package: "left-pad",
    version: "1.0.0",
    type: "envVars",
    severity: "middle" as const,
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
    type: "envVars",
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
      type: "envVars",
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
      type: "envVars",
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
})

describe("interpretSocketRun()", () => {
  function result(overrides: Parameters<typeof makeResult>[0] = {}) {
    return makeResult(overrides)
  }

  it("warns cli-not-installed on ENOENT spawn error", () => {
    const outcome = interpretSocketRun(
      result({ status: "spawn_error", spawnErrorCode: "ENOENT", stdout: "", exitCode: null }),
      0,
    )
    expect(outcome).toEqual({
      kind: "warn",
      rationale:
        "security-socket did not run (cli-not-installed) -- alerts were not evaluated. Install and authenticate @socketsecurity/cli to enable real enforcement.",
    })
  })
  it("does not treat a spawn_error with a different code as cli-not-installed", () => {
    const outcome = interpretSocketRun(
      result({ status: "spawn_error", spawnErrorCode: "EACCES", stdout: "", exitCode: null }),
      0,
    )
    expect(outcome.kind).not.toBe("warn")
  })
  it("does not treat an ENOENT spawnErrorCode as cli-not-installed unless status is also spawn_error", () => {
    const outcome = interpretSocketRun(
      result({ status: "completed", spawnErrorCode: "ENOENT", stdout: "not json" }),
      0,
    )
    expect(outcome).toEqual({
      kind: "fail",
      rationale: "`socket ci --json` produced no parseable JSON output (exit code 0).",
    })
  })
  it("fails on abnormal termination with the exact tool-labeled rationale", () => {
    const outcome = interpretSocketRun(result({ status: "timed_out" }), 0)
    expect(outcome).toEqual({
      kind: "fail",
      rationale: "socket did not run to completion (status: timed_out).",
    })
  })
  it("treats unparseable JSON stdout as parsed undefined, reaching the no-JSON fail branch", () => {
    const outcome = interpretSocketRun(result({ stdout: "not json" }), 0)
    expect(outcome).toEqual({
      kind: "fail",
      rationale: "`socket ci --json` produced no parseable JSON output (exit code 0).",
    })
  })
  it("parses JSON stdout padded with non-JSON-whitespace that only String.trim() strips", () => {
    const padded = `\v${JSON.stringify({ ok: true, alerts: [] })}\v`
    const outcome = interpretSocketRun(result({ stdout: padded }), 0)
    expect(outcome).toEqual({ kind: "ok", alerts: [] })
  })
  it("warns not-authenticated with no note when there are zero existing records", () => {
    const outcome = interpretSocketRun(
      result({ stdout: JSON.stringify({ ok: false, message: "Auth Error" }) }),
      0,
    )
    expect(outcome).toEqual({
      kind: "warn",
      rationale:
        "security-socket did not run (not-authenticated) -- alerts were not evaluated. Install and authenticate @socketsecurity/cli to enable real enforcement.",
    })
  })
  it("warns not-authenticated with the exact note when there are existing records", () => {
    const outcome = interpretSocketRun(
      result({ stdout: JSON.stringify({ ok: false, message: "Auth Error" }) }),
      3,
    )
    expect(outcome).toEqual({
      kind: "warn",
      rationale:
        "security-socket did not run (not-authenticated) -- alerts were not evaluated. Install and authenticate @socketsecurity/cli to enable real enforcement. 3 exception record(s) in .repo-contract/exceptions/socket.json were validated but not reconciled (the CLI produced no alert list this run).",
    })
  })
  it("warns network-unreachable", () => {
    const outcome = interpretSocketRun(
      result({ stdout: "", stderr: "getaddrinfo ENOTFOUND registry.socket.dev" }),
      0,
    )
    expect(outcome).toEqual({
      kind: "warn",
      rationale: "security-socket did not run (network-unreachable) -- alerts were not evaluated.",
    })
  })
  it("fails with no recognized ok field when parsed is a plain object without a boolean ok", () => {
    const outcome = interpretSocketRun(result({ stdout: JSON.stringify({ nothing: true }) }), 0)
    expect(outcome).toEqual({
      kind: "fail",
      rationale: '`socket ci --json` produced JSON with no recognized "ok" boolean field.',
    })
  })
  it("fails with no recognized ok field when parsed is not a plain object at all (an array)", () => {
    const outcome = interpretSocketRun(result({ stdout: JSON.stringify([1, 2]) }), 0)
    expect(outcome).toEqual({
      kind: "fail",
      rationale: '`socket ci --json` produced JSON with no recognized "ok" boolean field.',
    })
  })
  it("fails with the CLI's own message when ok is false with a string message", () => {
    const outcome = interpretSocketRun(
      result({ stdout: JSON.stringify({ ok: false, message: "custom failure" }) }),
      0,
    )
    expect(outcome).toEqual({
      kind: "fail",
      rationale: "security-socket scan failed: custom failure",
    })
  })
  it("fails with a generic message when ok is false with a non-string message", () => {
    const outcome = interpretSocketRun(result({ stdout: JSON.stringify({ ok: false }) }), 0)
    expect(outcome).toEqual({
      kind: "fail",
      rationale: "security-socket scan failed: socket ci reported an unrecognized failure.",
    })
  })
  it("passes with zero alerts for an empty alerts object", () => {
    const outcome = interpretSocketRun(
      result({ stdout: JSON.stringify({ ok: true, alerts: {} }) }),
      0,
    )
    expect(outcome).toEqual({ kind: "ok", alerts: [] })
  })
  it("reads alerts nested under data.alerts in preference to top-level alerts", () => {
    const alert = { package: "left-pad", version: "1.0.0", type: "envVars", severity: "middle" }
    const outcome = interpretSocketRun(
      result({
        stdout: JSON.stringify({ ok: true, data: { alerts: [alert] }, alerts: [] }),
      }),
      0,
    )
    expect(outcome).toEqual({
      kind: "ok",
      alerts: [
        {
          id: "socket:left-pad@1.0.0:envVars",
          package: "left-pad",
          version: "1.0.0",
          type: "envVars",
          severity: "middle",
        },
      ],
    })
  })
  it("falls back to top-level alerts when data.alerts is absent", () => {
    const alert = { package: "left-pad", version: "1.0.0", type: "envVars", severity: "low" }
    const outcome = interpretSocketRun(
      result({ stdout: JSON.stringify({ ok: true, alerts: [alert] }) }),
      0,
    )
    expect(outcome.kind).toBe("ok")
  })
  it("defaults to an empty array when neither data.alerts nor alerts is present", () => {
    const outcome = interpretSocketRun(result({ stdout: JSON.stringify({ ok: true }) }), 0)
    expect(outcome).toEqual({ kind: "ok", alerts: [] })
  })
  it("fails with the nested-shape rationale for a non-empty, non-array alerts object", () => {
    const outcome = interpretSocketRun(
      result({ stdout: JSON.stringify({ ok: true, alerts: { policyKey: {} } }) }),
      0,
    )
    expect(outcome).toMatchObject({ kind: "fail" })
    expect((outcome as { rationale: string }).rationale).toContain(
      "real nested-object shape this check does not yet parse",
    )
  })
  it("fails with the same rationale when alerts is neither array nor object", () => {
    const outcome = interpretSocketRun(
      result({ stdout: JSON.stringify({ ok: true, alerts: "nope" }) }),
      0,
    )
    expect(outcome).toMatchObject({ kind: "fail" })
    expect((outcome as { rationale: string }).rationale).toContain(
      "real nested-object shape this check does not yet parse",
    )
  })
  it("fails at the correct index when an alert entry in the middle of the array is malformed", () => {
    const good = { package: "left-pad", version: "1.0.0", type: "envVars", severity: "middle" }
    const bad = { package: "left-pad" }
    const outcome = interpretSocketRun(
      result({ stdout: JSON.stringify({ ok: true, alerts: [good, bad] }) }),
      0,
    )
    expect(outcome).toEqual({
      kind: "fail",
      rationale:
        "`socket ci --json` reported an alert entry (index 1) missing a required field (package/version/type).",
    })
  })
  it("returns the exact normalized alert list when every entry is well-formed", () => {
    const alert = { package: "left-pad", version: "1.0.0", type: "envVars", severity: "middle" }
    const outcome = interpretSocketRun(
      result({ stdout: JSON.stringify({ ok: true, alerts: [alert] }) }),
      0,
    )
    expect(outcome).toEqual({
      kind: "ok",
      alerts: [
        {
          id: "socket:left-pad@1.0.0:envVars",
          package: "left-pad",
          version: "1.0.0",
          type: "envVars",
          severity: "middle",
        },
      ],
    })
  })
})

describe("evaluateFinalVerdict()", () => {
  const alert = {
    id: "socket:left-pad@1.0.0:envVars",
    package: "left-pad",
    version: "1.0.0",
    type: "envVars",
    severity: "middle" as const,
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
      type: "envVars",
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
        "- socket:left-pad@1.0.0:envVars [critical]: forbidden by policy (above medium severity)",
      ].join("\n"),
    })
  })
  it("fails listing an unmatched offender with the exact line format", () => {
    const result = evaluateFinalVerdict([alert], registryWith())
    expect(result).toEqual({
      outcome: "fail",
      rationale: [
        "1 Socket alert(s) or stale record(s) need attention:",
        "- socket:left-pad@1.0.0:envVars [middle]: no reconciled exception record (registry integrity failure)",
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
      type: "envVars",
      severity: "middle" as const,
    }
    const result = evaluateFinalVerdict([alert], registryWith({ activeRecords: [record] }))
    expect(result).toEqual({
      outcome: "fail",
      rationale: [
        "1 Socket alert(s) or stale record(s) need attention:",
        "- socket:left-pad@1.0.0:envVars [middle]: exception incomplete (missing: justification, alternatives, remediation, method, exceptionType)",
      ].join("\n"),
    })
  })
  it("fails listing a stale record with the exact line format, combining counts with offenders", () => {
    const staleRecord = {
      id: "socket:old@1.0.0:envVars",
      version: 1 as const,
      justification: "j",
      alternatives: "",
      remediation: "",
      method: "independent-human-review" as const,
      exceptionType: "accepted-risk" as const,
      package: "old",
      packageVersion: "1.0.0",
      type: "envVars",
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
      type: "envVars",
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
        "- socket:left-pad@1.0.0:envVars [critical]: forbidden by policy (above medium severity)",
        '- Stale exception in .repo-contract/exceptions/socket.json: "socket:old@1.0.0:envVars" -- Socket no longer raises this alert; delete this entry.',
      ].join("\n"),
    })
  })
})
