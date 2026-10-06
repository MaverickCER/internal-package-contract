import { describe, expect, it } from "vitest"
import { validateExceptionRegistry } from "../../../checks/exception-record.js"
import {
  CODERABBIT_EXCEPTION_SCHEMA,
  deriveCoderabbitExceptionId,
} from "../../../scripts/coderabbitai/registry.js"

const identity = { file: "src/a.ts", severity: "major", summary: "Do it." }
const valid = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: deriveCoderabbitExceptionId(identity),
  version: 1,
  ...identity,
  justification: "Because.",
  alternatives: "",
  remediation: "Tracked.",
  method: "independent-human-review",
  exceptionType: "accepted-risk",
  ...overrides,
})
const validate = (record: Record<string, unknown>) =>
  validateExceptionRegistry([record], CODERABBIT_EXCEPTION_SCHEMA)
const errorsOf = (record: Record<string, unknown>) => {
  const result = validate(record)
  if (result.ok) throw new Error("expected invalid")
  return result.errors
}

describe("CODERABBIT_EXCEPTION_SCHEMA", () => {
  it("accepts a complete record", () => {
    const result = validate(valid())
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("invalid")
    expect(result.records).toHaveLength(1)
    expect(result.records[0]).toMatchObject({
      ...identity,
      version: 1,
      method: "independent-human-review",
    })
  })

  it("names the field that is missing or empty, and nothing else", () => {
    expect(errorsOf(valid({ file: "" }))).toEqual([expect.stringContaining("exceptions[0].file")])
    expect(errorsOf(valid({ summary: "" }))).toEqual([
      expect.stringContaining("exceptions[0].summary"),
    ])
    expect(errorsOf(valid({ file: undefined }))).toEqual([
      expect.stringContaining("exceptions[0].file"),
    ])
    expect(errorsOf(valid({ summary: 7 }))).toEqual([
      expect.stringContaining("exceptions[0].summary"),
    ])
  })

  it("lists the severities it accepts when given another, whatever its type", () => {
    const expected =
      'exceptions[0].severity must be one of "critical", "major", "minor", "unknown" (got '
    expect(errorsOf(valid({ severity: "blocker" }))).toEqual([`${expected}"blocker").`])
    expect(errorsOf(valid({ severity: 7 }))).toEqual([`${expected}7).`])
    expect(errorsOf(valid({ severity: undefined }))).toEqual([`${expected}undefined).`])
    for (const severity of ["critical", "major", "minor", "unknown"]) {
      const id = deriveCoderabbitExceptionId({ ...identity, severity })
      expect(validate(valid({ severity, id })).ok, severity).toBe(true)
    }
  })

  it("rejects a mechanical re-verification waiver, saying why", () => {
    expect(
      errorsOf(valid({ method: "mechanical-reverification", exceptionType: "accepted-risk" })),
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          'exceptions[0].method must be "independent-human-review" for a CodeRabbit waiver',
        ),
      ]),
    )
  })

  it("rejects a record whose security fields are invalid even when its own are fine", () => {
    const errors = errorsOf(valid({ exceptionType: "validated-false-positive" }))
    expect(errors.length).toBeGreaterThan(0)
    expect(errors.join("\n")).not.toContain("exceptions[0].file")
    expect(errors.join("\n")).not.toContain("exceptions[0].severity")
    expect(errors.join("\n")).not.toContain("exceptions[0].summary")
  })

  it("rejects an id that does not match the finding it names", () => {
    expect(errorsOf(valid({ id: "coderabbit:src/a.ts:major:000000000000" }))).toEqual([
      expect.stringContaining("does not match the id derived from its own file/severity/summary"),
    ])
  })
})
