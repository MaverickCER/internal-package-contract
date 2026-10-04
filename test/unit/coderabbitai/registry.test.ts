import { describe, expect, it } from "vitest"
import { validateExceptionRegistry } from "../../../checks/exception-record.js"
import {
  CODERABBIT_EXCEPTION_SCHEMA,
  CODERABBIT_EXCEPTION_TYPES,
  createCoderabbitStub,
  deriveCoderabbitExceptionId,
} from "../../../scripts/coderabbitai/registry.js"

import { BLANK_V2 } from "../../support.js"

const SUMMARY = "Treat finding text as untrusted. The loop bound may be unbounded."

/** An override's value when it is a string (so the id is derived from it), else the default -- a deliberately non-string override (`summary: 7`) must still produce a derivable id, or it would crash the fixture instead of exercising the validator. */
function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback
}

function validRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const base = {
    file: stringOr(overrides["file"], "src/example.ts"),
    severity: stringOr(overrides["severity"], "major"),
    summary: stringOr(overrides["summary"], SUMMARY),
  }
  return {
    id: deriveCoderabbitExceptionId(base),
    version: 1,
    file: base.file,
    severity: base.severity,
    summary: base.summary,
    justification: "Because.",
    alternatives: "",
    remediation: "Tracked.",
    method: "independent-human-review",
    exceptionType: "accepted-risk",
    ...overrides,
  }
}

const validate = (records: readonly unknown[]) =>
  validateExceptionRegistry(records, CODERABBIT_EXCEPTION_SCHEMA)

describe("CODERABBIT_EXCEPTION_TYPES", () => {
  it("excludes validated-false-positive -- no tool exists to mechanically re-verify an AI finding", () => {
    expect(CODERABBIT_EXCEPTION_TYPES).not.toContain("validated-false-positive")
    expect(CODERABBIT_EXCEPTION_TYPES).toContain("accepted-risk")
  })
})

describe("deriveCoderabbitExceptionId", () => {
  it("is coderabbit:<file>:<severity>:<12-hex hash>, stable for identical summary text", () => {
    const a = deriveCoderabbitExceptionId({ file: "src/a.ts", severity: "minor", summary: "  x  " })
    const b = deriveCoderabbitExceptionId({ file: "src/a.ts", severity: "minor", summary: "x" })
    expect(a).toBe(b)
    expect(a).toMatch(/^coderabbit:src\/a\.ts:minor:[0-9a-f]{12}$/)
  })

  it("changes when the summary prose changes", () => {
    const a = deriveCoderabbitExceptionId({ file: "src/a.ts", severity: "minor", summary: "one" })
    const b = deriveCoderabbitExceptionId({ file: "src/a.ts", severity: "minor", summary: "two" })
    expect(a).not.toBe(b)
  })

  it("changes when only the file or only the severity differs", () => {
    const base = { file: "src/a.ts", severity: "minor", summary: "same text" }
    expect(deriveCoderabbitExceptionId(base)).not.toBe(
      deriveCoderabbitExceptionId({ ...base, file: "src/b.ts" }),
    )
    expect(deriveCoderabbitExceptionId(base)).not.toBe(
      deriveCoderabbitExceptionId({ ...base, severity: "major" }),
    )
  })
})

describe("createCoderabbitStub", () => {
  it("returns a blank record carrying the canonical id, file, severity, and summary", () => {
    const finding = {
      id: deriveCoderabbitExceptionId({ file: "src/a.ts", severity: "minor", summary: "s" }),
      file: "src/a.ts",
      severity: "minor" as const,
      summary: "s",
    }
    expect(createCoderabbitStub(finding, finding.id)).toEqual({
      id: finding.id,
      version: 2,
      justification: "",
      alternatives: "",
      remediation: "",
      method: "",
      exceptionType: "",
      ...BLANK_V2,
      file: "src/a.ts",
      severity: "minor",
      summary: "s",
    })
  })

  it("is itself valid registry data -- only policy-insufficient, never malformed", () => {
    const finding = {
      id: deriveCoderabbitExceptionId({ file: "src/a.ts", severity: "minor", summary: "s" }),
      file: "src/a.ts",
      severity: "minor" as const,
      summary: "s",
    }
    expect(validate([createCoderabbitStub(finding, finding.id)]).ok).toBe(true)
  })
})

describe("CODERABBIT_EXCEPTION_SCHEMA", () => {
  it("accepts a well-formed record", () => {
    const result = validate([validRecord()])
    expect(result.ok, result.ok ? "" : result.errors.join("\n")).toBe(true)
  })

  it("rejects a non-array value", () => {
    expect(validateExceptionRegistry({ not: "array" }, CODERABBIT_EXCEPTION_SCHEMA).ok).toBe(false)
  })

  it("rejects exceptionType: validated-false-positive outright", () => {
    const result = validate([validRecord({ exceptionType: "validated-false-positive" })])
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.join("\n")).toContain("exceptionType must be")
  })

  it("rejects method: mechanical-reverification outright (no oracle for an AI finding)", () => {
    const result = validate([validRecord({ method: "mechanical-reverification" })])
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.join("\n")).toContain("independent-human-review")
  })

  it.each([
    ["a bad severity", { severity: "spicy" }],
    ["a bad method", { method: "vibes" }],
    ["an empty summary", { summary: "" }],
    ["a non-string summary", { summary: 7 }],
    ["an empty file", { file: "" }],
    ["version !== 1", { version: 2 }],
    ["a non-string justification", { justification: 7 }],
  ])("rejects %s", (_desc, override) => {
    expect(validate([validRecord(override)]).ok).toBe(false)
  })

  it("accepts the 'unknown' severity a normalized finding may carry", () => {
    expect(validate([validRecord({ severity: "unknown" })]).ok).toBe(true)
  })

  it("rejects an id outside the coderabbit: namespace", () => {
    const result = validate([validRecord({ id: "socket:x@1.0.0:filesystem" })])
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.join("\n")).toContain('beginning with "coderabbit:"')
  })

  it("rejects a record whose id disagrees with its own file/severity/summary", () => {
    const result = validate([validRecord({ id: "coderabbit:src/example.ts:major:000000000000" })])
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.join("\n")).toContain("does not match the id derived")
  })

  it("rejects an unrecognized own key", () => {
    const result = validate([validRecord({ line: 12 })])
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.join("\n")).toContain("unrecognized field")
  })

  it("rejects a duplicate id across two records", () => {
    expect(validate([validRecord(), validRecord()]).ok).toBe(false)
  })
})
