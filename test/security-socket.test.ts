import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { securitySocket } from "../checks/security-socket.js"
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

  it("fails when ok is true but alerts is not an array", async () => {
    const check = securitySocket()
    const result = await check.policy(makeContext(ciOutput({ ok: true, alerts: "nope" })))
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain('non-array "alerts" field')
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

  it("fails when the on-disk registry is malformed", async () => {
    mkdirSync(path.dirname(registryPath()), { recursive: true })
    writeFileSync(
      registryPath(),
      JSON.stringify({ exceptions: [{ id: "not-namespaced", version: 1 }] }),
      "utf8",
    )
    const check = securitySocket()
    const result = await check.policy(makeContext(ciOutput({ ok: true, alerts: [] })))
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain("failed to load")
  })
})
