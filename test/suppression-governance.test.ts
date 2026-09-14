import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { suppressionGovernance } from "../checks/suppression-governance.js"
import { makeContext, makeJsonResult, makeResult } from "./support.js"

function deriveId(finding: {
  readonly domain: string
  readonly rule: readonly string[]
  readonly file: string
  readonly line: number
}): string {
  return `suppression:${finding.domain}:${finding.rule.join(",")}:${finding.file}:${String(finding.line)}`
}

let cwd: string

beforeEach(() => {
  cwd = mkdtempSync(path.join(tmpdir(), "ipc-suppression-governance-test-"))
  vi.spyOn(process, "cwd").mockReturnValue(cwd)
})

afterEach(() => {
  vi.restoreAllMocks()
  rmSync(cwd, { recursive: true, force: true })
})

function registryPath(): string {
  return path.join(process.cwd(), ".repo-contract/exceptions/suppressions.json")
}

function writeRegistry(exceptions: readonly unknown[]): void {
  mkdirSync(path.dirname(registryPath()), { recursive: true })
  writeFileSync(registryPath(), JSON.stringify({ exceptions }), "utf8")
}

function readRegistry(): { exceptions: readonly Record<string, unknown>[] } {
  return JSON.parse(readFileSync(registryPath(), "utf8"))
}

function finding(overrides: Partial<Record<string, unknown>> = {}) {
  const base = {
    domain: "eslint",
    rule: ["no-console"],
    file: "src/index.ts",
    line: 12,
    content: "eslint-disable-next-line no-console",
    reason: "",
  }
  const f = { ...base, ...overrides }
  return { id: deriveId(f as never), ...f }
}

function discoveryResult(findings: readonly unknown[]) {
  return makeJsonResult({ ok: true, findings })
}

function completeRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const f = finding()
  const base = {
    id: f.id,
    version: 1,
    justification: "Console logging is this CLI's own user-facing output, not debug noise.",
    category: "rule-not-applicable",
    verificationMethod: "static-reasoning",
    domain: f.domain,
    file: f.file,
    line: f.line,
    rule: f.rule,
  }
  return { ...base, ...overrides }
}

describe("suppressionGovernance", () => {
  it("fails when the scan terminated abnormally", async () => {
    const result = await suppressionGovernance.policy(
      makeContext(makeResult({ status: "timed_out" })),
    )
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain("did not run to completion")
  })

  it("fails when the scan's own output could not be parsed as JSON", async () => {
    const result = await suppressionGovernance.policy(
      makeContext(makeResult({ output: { format: "json", success: false, error: "bad" } })),
    )
    expect(result).toEqual({
      outcome: "fail",
      rationale: "check-suppressions output could not be parsed as JSON.",
    })
  })

  it("fails when discovery itself reports a failure", async () => {
    const result = await suppressionGovernance.policy(
      makeContext(makeJsonResult({ ok: false, error: "Suppression discovery failed: boom" })),
    )
    expect(result).toEqual({ outcome: "fail", rationale: "Suppression discovery failed: boom" })
  })

  it("passes with zero suppressions and leaves an empty registry alone", async () => {
    const result = await suppressionGovernance.policy(makeContext(discoveryResult([])))
    expect(result).toEqual({
      outcome: "pass",
      rationale: "0 suppression(s) evaluated: all permitted by a complete exception record.",
    })
  })

  it("fails and scaffolds a blank stub for a new, unmatched suppression -- never silently accepted", async () => {
    const f = finding()
    const result = await suppressionGovernance.policy(makeContext(discoveryResult([f])))
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain(
      "exception incomplete (missing: justification, category, verificationMethod)",
    )

    const written = readRegistry().exceptions
    expect(written).toHaveLength(1)
    expect(written[0]).toMatchObject({
      id: f.id,
      justification: "",
      category: "",
      verificationMethod: "",
      domain: f.domain,
      file: f.file,
      line: f.line,
    })
  })

  it("passes a suppression with a complete, matching exception record", async () => {
    const f = finding()
    writeRegistry([completeRecord()])
    const result = await suppressionGovernance.policy(makeContext(discoveryResult([f])))
    expect(result).toEqual({
      outcome: "pass",
      rationale: "1 suppression(s) evaluated: all permitted by a complete exception record.",
    })
  })

  it("fails an incomplete exception record, listing exactly which fields are missing", async () => {
    const f = finding()
    writeRegistry([completeRecord({ category: "", verificationMethod: "" })])
    const result = await suppressionGovernance.policy(makeContext(discoveryResult([f])))
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain(
      "exception incomplete (missing: category, verificationMethod)",
    )
  })

  it("reports a stale record that matches no current finding", async () => {
    writeRegistry([completeRecord()])
    const result = await suppressionGovernance.policy(makeContext(discoveryResult([])))
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain("its directive is gone")
  })

  it("treats a moved line as a genuinely new finding, not a match against the old exception", async () => {
    writeRegistry([completeRecord()])
    const moved = finding({ line: 99 })
    const result = await suppressionGovernance.policy(makeContext(discoveryResult([moved])))
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain("exception incomplete")
    expect(result.rationale).toContain("its directive is gone")
  })

  it("fails when the on-disk registry is malformed", async () => {
    mkdirSync(path.dirname(registryPath()), { recursive: true })
    writeFileSync(
      registryPath(),
      JSON.stringify({ exceptions: [{ id: "not-namespaced", version: 1 }] }),
      "utf8",
    )
    const result = await suppressionGovernance.policy(makeContext(discoveryResult([])))
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain("failed to load")
  })

  it.each([
    ["an invalid category", { category: "not-a-real-category" }],
    ["an invalid verificationMethod", { verificationMethod: "not-a-real-method" }],
    ["an empty domain", { domain: "" }],
    ["an empty file", { file: "" }],
    ["a zero line", { line: 0 }],
    ["a negative line", { line: -1 }],
    ["a non-integer line", { line: 1.5 }],
    ["an empty rule array", { rule: [] }],
    ["a rule array with an empty string", { rule: [""] }],
  ])("rejects a record with %s", async (_desc, override) => {
    writeRegistry([completeRecord(override)])
    const result = await suppressionGovernance.policy(makeContext(discoveryResult([])))
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain("failed to load")
  })

  it("rejects a record whose id disagrees with its own domain/rule/file/line", async () => {
    writeRegistry([completeRecord({ id: "suppression:eslint:no-console:src/index.ts:999" })])
    const result = await suppressionGovernance.policy(makeContext(discoveryResult([])))
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain("failed to load")
  })

  it("governs a typescript-domain suppression identically to an eslint one", async () => {
    const f = finding({
      domain: "typescript",
      rule: ["@ts-expect-error"],
      file: "src/legacy.ts",
      line: 5,
      content: "@ts-expect-error legacy API mismatch",
      reason: "legacy API mismatch",
    })
    const result = await suppressionGovernance.policy(makeContext(discoveryResult([f])))
    expect(result.outcome).toBe("fail")
    expect(result.rationale).toContain("src/legacy.ts:5 [typescript: @ts-expect-error]")
  })
})
