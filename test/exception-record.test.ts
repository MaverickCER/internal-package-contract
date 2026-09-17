import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { ExceptionRecordCore } from "repo-contract/helpers"
import {
  EXCEPTION_TYPES,
  evaluateFindingVerdict,
  isValidNonEmptyStringField,
  reconcileAndPersistExceptionRegistry,
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

  it("rejects null (typeof null is also 'object', but it is not a plain object either)", () => {
    const result = validateExceptionRegistry([null], SCHEMA)
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

  it("a bad id alone reports exactly one error -- schema.validateRecord is never reached, so a simultaneously-invalid name is never itself reported", () => {
    const result = validateExceptionRegistry(
      [{ id: "wrong:a", version: 1, justification: "x", name: "" }],
      SCHEMA,
    )
    expect(result).toEqual({
      ok: false,
      errors: [
        'exceptions[0].id must be a non-empty string beginning with "test:" (got "wrong:a").',
      ],
    })
  })

  it("a bad version alone reports exactly one error -- schema.validateRecord is never reached, so a simultaneously-invalid name is never itself reported", () => {
    const result = validateExceptionRegistry(
      [{ id: "test:a", version: 2, justification: "x", name: "" }],
      SCHEMA,
    )
    expect(result).toEqual({
      ok: false,
      errors: ["exceptions[0].version must be the number 1 (got 2)."],
    })
  })

  it("a bad justification alone reports exactly one error -- schema.validateRecord is never reached, so a simultaneously-invalid name is never itself reported", () => {
    const result = validateExceptionRegistry(
      [{ id: "test:a", version: 1, justification: 42, name: "" }],
      SCHEMA,
    )
    expect(result).toEqual({
      ok: false,
      errors: ["exceptions[0].justification must be a string."],
    })
  })

  it("an unrecognized field alone reports exactly one error -- schema.validateRecord is never reached, so a simultaneously-invalid name is never itself reported", () => {
    const result = validateExceptionRegistry(
      [{ id: "test:a", version: 1, justification: "x", name: "", extra: true }],
      SCHEMA,
    )
    expect(result).toEqual({
      ok: false,
      errors: [
        'exceptions[0] has unrecognized field(s) "extra" -- only "id", "version", "justification", "name" are permitted.',
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

  it("rejects an unrecognized method, naming every recognized method and the offending value, exactly", () => {
    const errors: string[] = []
    const result = validateSecurityExceptionFields(
      blank({ method: "guessing" }),
      0,
      EXCEPTION_TYPES,
      errors,
    )
    expect(result).toBeUndefined()
    expect(errors).toEqual([
      'exceptions[0].method must be "" or one of "mechanical-reverification", "independent-human-review" (got "guessing").',
    ])
  })

  it("rejects an exceptionType outside the caller's own allowed subset, naming that subset (comma-separated) and the offending value, exactly", () => {
    const errors: string[] = []
    const result = validateSecurityExceptionFields(
      blank({ exceptionType: "compensating-control" }),
      0,
      ["tooling-limitation", "scheduled-remediation"],
      errors,
    )
    expect(result).toBeUndefined()
    expect(errors).toEqual([
      'exceptions[0].exceptionType must be "" or one of "tooling-limitation", "scheduled-remediation" (got "compensating-control").',
    ])
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

describe("isValidNonEmptyStringField", () => {
  it("accepts a non-empty string, pushing no error", () => {
    const errors: string[] = []
    expect(isValidNonEmptyStringField("a", "field", errors)).toBe(true)
    expect(errors).toEqual([])
  })

  it("rejects an empty string, pushing the exact message", () => {
    const errors: string[] = []
    expect(isValidNonEmptyStringField("", "field", errors)).toBe(false)
    expect(errors).toEqual(["field must be a non-empty string."])
  })

  it("rejects a non-string value, pushing the exact message", () => {
    const errors: string[] = []
    expect(isValidNonEmptyStringField(42, "field", errors)).toBe(false)
    expect(errors).toEqual(["field must be a non-empty string."])
  })

  it("rejects undefined", () => {
    const errors: string[] = []
    expect(isValidNonEmptyStringField(undefined, "field", errors)).toBe(false)
    expect(errors).toEqual(["field must be a non-empty string."])
  })
})

describe("evaluateFindingVerdict", () => {
  interface Rec {
    readonly id: string
    readonly justification: string
    readonly count?: number
  }

  it("returns unmatched with no missing fields when the record is undefined -- the reconcile<->evaluate bijection short-circuit", () => {
    const result = evaluateFindingVerdict<Rec>(
      undefined,
      [{ group: "test", category: "a" }],
      {},
      { mode: "allowed" },
    )
    expect(result).toEqual({ verdict: "unmatched", missing: [] })
  })

  it("returns permitted when the resolved policy is allowed", () => {
    const record: Rec = { id: "x", justification: "" }
    const result = evaluateFindingVerdict(
      record,
      [{ group: "test", category: "a" }],
      { test: { rules: { a: { mode: "allowed" } } } },
      { mode: "forbidden" },
    )
    expect(result).toEqual({ verdict: "permitted", missing: [] })
  })

  it("returns forbidden when the resolved policy is forbidden", () => {
    const record: Rec = { id: "x", justification: "" }
    const result = evaluateFindingVerdict(
      record,
      [{ group: "test", category: "a" }],
      { test: { rules: { a: { mode: "forbidden" } } } },
      { mode: "allowed" },
    )
    expect(result).toEqual({ verdict: "forbidden", missing: [] })
  })

  it("returns insufficient, naming a blank required field, for an exception policy", () => {
    const record: Rec = { id: "x", justification: "" }
    const result = evaluateFindingVerdict(
      record,
      [{ group: "test", category: "a" }],
      { test: { rules: { a: { mode: "exception", requirements: ["justification"] } } } },
      { mode: "allowed" },
    )
    expect(result).toEqual({ verdict: "insufficient", missing: ["justification"] })
  })

  it("returns permitted once every required field is filled in", () => {
    const record: Rec = { id: "x", justification: "because" }
    const result = evaluateFindingVerdict(
      record,
      [{ group: "test", category: "a" }],
      { test: { rules: { a: { mode: "exception", requirements: ["justification"] } } } },
      { mode: "allowed" },
    )
    expect(result).toEqual({ verdict: "permitted", missing: [] })
  })

  it("reads a non-string field as empty via the generic field-value accessor, so a numeric field can never satisfy a requirement", () => {
    const record: Rec = { id: "x", justification: "because", count: 5 }
    const result = evaluateFindingVerdict(
      record,
      [{ group: "test", category: "a" }],
      { test: { rules: { a: { mode: "exception", requirements: ["count"] } } } },
      { mode: "allowed" },
    )
    expect(result).toEqual({ verdict: "insufficient", missing: ["count"] })
  })
})

describe("reconcileAndPersistExceptionRegistry", () => {
  interface Finding {
    readonly id: string
  }
  interface Record_ {
    readonly id: string
    readonly version: 1
    readonly justification: string
    readonly name: string
  }

  let dir: string
  let registryPath: string

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "ipc-exception-record-test-"))
    registryPath = path.join(dir, "exceptions", "test.json")
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  function createStub(finding: Finding, id: string): Record_ {
    return { id, version: 1, justification: "", name: finding.id }
  }

  it("creates a fresh stub for a new finding, writes it to disk, and reports its id as new", async () => {
    const result = await reconcileAndPersistExceptionRegistry<Finding, Record_>(
      registryPath,
      "exceptions/test.json",
      [],
      [{ id: "a" }],
      createStub,
    )
    expect(result).toEqual({
      ok: true,
      registry: {
        activeRecords: [{ id: "a", version: 1, justification: "", name: "a" }],
        staleRecords: [],
        newStubIds: ["a"],
      },
    })
    const onDisk = JSON.parse(readFileSync(registryPath, "utf8")) as { exceptions: unknown[] }
    expect(onDisk.exceptions).toEqual([{ id: "a", version: 1, justification: "", name: "a" }])
  })

  it("keeps a matched existing record verbatim and surfaces an unmatched existing record as stale, never dropping it", async () => {
    const existing: readonly Record_[] = [
      { id: "a", version: 1, justification: "kept", name: "a" },
      { id: "old", version: 1, justification: "gone", name: "old" },
    ]
    const result = await reconcileAndPersistExceptionRegistry<Finding, Record_>(
      registryPath,
      "exceptions/test.json",
      existing,
      [{ id: "a" }],
      createStub,
    )
    expect(result).toEqual({
      ok: true,
      registry: {
        activeRecords: [{ id: "a", version: 1, justification: "kept", name: "a" }],
        staleRecords: [{ id: "old", version: 1, justification: "gone", name: "old" }],
        newStubIds: [],
      },
    })
  })

  it("fails with a rationale naming the registry path when reconciliation itself fails (a deriveId collision)", async () => {
    const result = await reconcileAndPersistExceptionRegistry<Finding, Record_>(
      registryPath,
      "exceptions/test.json",
      [],
      [{ id: "a" }, { id: "a" }],
      createStub,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.rationale).toContain("exceptions/test.json could not be reconciled")
    }
  })

  it("fails with a rationale naming the registry path when the write itself fails (a symlinked target)", async () => {
    const { mkdirSync } = await import("node:fs")
    mkdirSync(path.dirname(registryPath), { recursive: true })
    const elsewhere = path.join(dir, "elsewhere.json")
    writeFileSync(elsewhere, "{}")
    symlinkSync(elsewhere, registryPath)

    const result = await reconcileAndPersistExceptionRegistry<Finding, Record_>(
      registryPath,
      "exceptions/test.json",
      [],
      [{ id: "a" }],
      createStub,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.rationale).toContain("Writing exceptions/test.json failed")
    }
  })

  it("fails with a rationale naming the registry path when mkdir itself throws (a path segment is a file, not a directory)", async () => {
    const blocker = path.join(dir, "blocker")
    writeFileSync(blocker, "not a directory")
    const badPath = path.join(blocker, "sub", "test.json")

    const result = await reconcileAndPersistExceptionRegistry<Finding, Record_>(
      badPath,
      "exceptions/test.json",
      [],
      [{ id: "a" }],
      createStub,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.rationale).toContain("Could not write exceptions/test.json")
    }
  })
})
