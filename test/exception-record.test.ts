import { describe, expect, it } from "vitest"
import type { ExceptionRecordCore } from "repo-contract/helpers"
import {
  EXCEPTION_TYPES,
  validateExceptionRegistry,
  validateSecurityExceptionFields,
} from "../checks/exception-record.js"
import type { ExceptionRegistrySchema } from "../checks/exception-record.js"

interface TestRecord {
  readonly id: string
  readonly version: 1
  readonly justification: string
  readonly name: string
}

const SCHEMA: ExceptionRegistrySchema<TestRecord> = {
  namespace: "test:",
  metadataKeys: ["name"],
  validateRecord(core: ExceptionRecordCore, raw, index, errors) {
    const { name } = raw
    if (typeof name !== "string" || name.length === 0) {
      errors.push(`exceptions[${String(index)}].name must be a non-empty string.`)
      return undefined
    }
    return { id: core.id, version: 1, justification: core.justification, name }
  },
}

describe("validateExceptionRegistry", () => {
  it("rejects a non-array value", () => {
    const result = validateExceptionRegistry({ not: "an array" }, SCHEMA)
    expect(result).toEqual({
      ok: false,
      errors: ['An exception registry\'s "exceptions" must be a JSON array of records.'],
    })
  })

  it("accepts an empty array", () => {
    expect(validateExceptionRegistry([], SCHEMA)).toEqual({ ok: true, records: [] })
  })

  it("validates and rebuilds a well-formed record", () => {
    const result = validateExceptionRegistry(
      [{ id: "test:a", version: 1, justification: "because", name: "a" }],
      SCHEMA,
    )
    expect(result).toEqual({
      ok: true,
      records: [{ id: "test:a", version: 1, justification: "because", name: "a" }],
    })
  })

  it("rejects a non-object entry", () => {
    const result = validateExceptionRegistry(["not an object"], SCHEMA)
    expect(result).toEqual({ ok: false, errors: ["exceptions[0] must be an object."] })
  })

  it("rejects an array entry (typeof array is 'object', but it is not a plain object)", () => {
    const result = validateExceptionRegistry([["not", "an", "object"]], SCHEMA)
    expect(result).toEqual({ ok: false, errors: ["exceptions[0] must be an object."] })
  })

  it("rejects an unrecognized field, naming both it and the allowed set, exactly", () => {
    const result = validateExceptionRegistry(
      [{ id: "test:a", version: 1, justification: "x", name: "a", extra: true }],
      SCHEMA,
    )
    expect(result).toEqual({
      ok: false,
      errors: [
        'exceptions[0] has unrecognized field(s) "extra" -- only "id", "version", "justification", "name" are permitted.',
      ],
    })
  })

  it("joins multiple unrecognized fields with a comma", () => {
    const result = validateExceptionRegistry(
      [{ id: "test:a", version: 1, justification: "x", name: "a", extra: true, another: 1 }],
      SCHEMA,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors[0]).toContain('"extra", "another"')
    }
  })

  it("rejects a record for unrecognized field(s) alone, even when id/version/justification are all otherwise valid", () => {
    const result = validateExceptionRegistry(
      [{ id: "test:a", version: 1, justification: "x", name: "a", extra: true }],
      SCHEMA,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors).toHaveLength(1)
  })

  it("rejects an id that does not start with the schema's namespace", () => {
    const result = validateExceptionRegistry(
      [{ id: "wrong:a", version: 1, justification: "x", name: "a" }],
      SCHEMA,
    )
    expect(result).toEqual({
      ok: false,
      errors: [
        'exceptions[0].id must be a non-empty string beginning with "test:" (got "wrong:a").',
      ],
    })
  })

  it("rejects an id equal to just the namespace (nothing after it)", () => {
    const result = validateExceptionRegistry(
      [{ id: "test:", version: 1, justification: "x", name: "a" }],
      SCHEMA,
    )
    expect(result.ok).toBe(false)
  })

  it("rejects a non-string id", () => {
    const result = validateExceptionRegistry(
      [{ id: 123, version: 1, justification: "x", name: "a" }],
      SCHEMA,
    )
    expect(result.ok).toBe(false)
  })

  it("rejects a version other than the number 1", () => {
    const result = validateExceptionRegistry(
      [{ id: "test:a", version: 2, justification: "x", name: "a" }],
      SCHEMA,
    )
    expect(result).toEqual({
      ok: false,
      errors: ["exceptions[0].version must be the number 1 (got 2)."],
    })
  })

  it("rejects a non-string justification", () => {
    const result = validateExceptionRegistry(
      [{ id: "test:a", version: 1, justification: 42, name: "a" }],
      SCHEMA,
    )
    expect(result).toEqual({
      ok: false,
      errors: ["exceptions[0].justification must be a string."],
    })
  })

  it("accepts an empty justification -- completeness is a policy concern, not a schema one", () => {
    const result = validateExceptionRegistry(
      [{ id: "test:a", version: 1, justification: "", name: "a" }],
      SCHEMA,
    )
    expect(result).toEqual({
      ok: true,
      records: [{ id: "test:a", version: 1, justification: "", name: "a" }],
    })
  })

  it("delegates registry-specific fields to schema.validateRecord, surfacing its errors", () => {
    const result = validateExceptionRegistry(
      [{ id: "test:a", version: 1, justification: "x", name: "" }],
      SCHEMA,
    )
    expect(result).toEqual({
      ok: false,
      errors: ["exceptions[0].name must be a non-empty string."],
    })
  })

  it("rejects a duplicate id, naming both indices", () => {
    const result = validateExceptionRegistry(
      [
        { id: "test:a", version: 1, justification: "x", name: "a" },
        { id: "test:a", version: 1, justification: "y", name: "b" },
      ],
      SCHEMA,
    )
    expect(result).toEqual({
      ok: false,
      errors: ['exceptions[1] reuses the id "test:a" already held by exceptions[0].'],
    })
  })

  it("reports every problem across the whole registry, not just the first", () => {
    const result = validateExceptionRegistry(
      [
        { id: "wrong:a", version: 1, justification: "x", name: "a" },
        { id: "test:b", version: 2, justification: "x", name: "b" },
      ],
      SCHEMA,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors).toHaveLength(2)
  })

  it("a core-level failure on one record still lets every OTHER record's own problems (or lack thereof) be reported, not just the first failure", () => {
    const result = validateExceptionRegistry(
      [
        { id: "test:a", version: "not-a-number", justification: "x", name: "a" },
        { id: "test:b", version: 1, justification: "x", name: "" },
      ],
      SCHEMA,
    )
    expect(result).toEqual({
      ok: false,
      errors: [
        'exceptions[0].version must be the number 1 (got "not-a-number").',
        "exceptions[1].name must be a non-empty string.",
      ],
    })
  })
})

describe("validateSecurityExceptionFields", () => {
  function blank(overrides: Record<string, unknown> = {}) {
    return { alternatives: "", remediation: "", method: "", exceptionType: "", ...overrides }
  }

  it("accepts an all-blank stub (completeness is the policy's concern, not the validator's)", () => {
    const errors: string[] = []
    const result = validateSecurityExceptionFields(blank(), 0, EXCEPTION_TYPES, errors)
    expect(result).toEqual({ alternatives: "", remediation: "", method: "", exceptionType: "" })
    expect(errors).toEqual([])
  })

  it("accepts a fully-filled, well-formed record", () => {
    const errors: string[] = []
    const result = validateSecurityExceptionFields(
      blank({
        alternatives: "None available.",
        remediation: "Tracked in issue #1.",
        method: "independent-human-review",
        exceptionType: "accepted-risk",
      }),
      0,
      EXCEPTION_TYPES,
      errors,
    )
    expect(result).toEqual({
      alternatives: "None available.",
      remediation: "Tracked in issue #1.",
      method: "independent-human-review",
      exceptionType: "accepted-risk",
    })
    expect(errors).toEqual([])
  })

  it("rejects a non-string alternatives", () => {
    const errors: string[] = []
    const result = validateSecurityExceptionFields(
      blank({ alternatives: 1 }),
      0,
      EXCEPTION_TYPES,
      errors,
    )
    expect(result).toBeUndefined()
    expect(errors).toContain("exceptions[0].alternatives must be a string.")
  })

  it("rejects a non-string remediation", () => {
    const errors: string[] = []
    const result = validateSecurityExceptionFields(
      blank({ remediation: 1 }),
      0,
      EXCEPTION_TYPES,
      errors,
    )
    expect(result).toBeUndefined()
    expect(errors).toContain("exceptions[0].remediation must be a string.")
  })

  it("rejects an unrecognized method", () => {
    const errors: string[] = []
    const result = validateSecurityExceptionFields(
      blank({ method: "guessing" }),
      0,
      EXCEPTION_TYPES,
      errors,
    )
    expect(result).toBeUndefined()
    expect(errors[0]).toContain("exceptions[0].method must be")
  })

  it("rejects an exceptionType outside the caller's own allowed subset", () => {
    const errors: string[] = []
    const result = validateSecurityExceptionFields(
      blank({ exceptionType: "accepted-risk" }),
      0,
      ["tooling-limitation"],
      errors,
    )
    expect(result).toBeUndefined()
    expect(errors[0]).toContain("exceptions[0].exceptionType must be")
  })

  it("rejects validated-false-positive paired with any method other than mechanical-reverification", () => {
    const errors: string[] = []
    const result = validateSecurityExceptionFields(
      blank({ exceptionType: "validated-false-positive", method: "independent-human-review" }),
      0,
      EXCEPTION_TYPES,
      errors,
    )
    expect(result).toBeUndefined()
    expect(errors[0]).toContain('requires method "mechanical-reverification"')
  })

  it("accepts validated-false-positive paired with mechanical-reverification", () => {
    const errors: string[] = []
    const result = validateSecurityExceptionFields(
      blank({ exceptionType: "validated-false-positive", method: "mechanical-reverification" }),
      0,
      EXCEPTION_TYPES,
      errors,
    )
    expect(result).toMatchObject({ exceptionType: "validated-false-positive" })
    expect(errors).toEqual([])
  })

  it("accepts validated-false-positive with method still blank (not yet filled in)", () => {
    const errors: string[] = []
    const result = validateSecurityExceptionFields(
      blank({ exceptionType: "validated-false-positive" }),
      0,
      EXCEPTION_TYPES,
      errors,
    )
    expect(result).toMatchObject({ exceptionType: "validated-false-positive", method: "" })
    expect(errors).toEqual([])
  })
})
