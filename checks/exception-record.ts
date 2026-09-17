/**
 * The generic, check-owned exception-registry validator every `.repo-contract/exceptions/*.json`
 * file in a CONSUMER repository shares -- the layer `repo-contract/helpers`' own
 * specs/decisions/0013-reusable-exception-policy-helper.md deliberately leaves unpublished
 * ("Not published; an outside consumer wanting it writes their own"), ported here so every check
 * in this package that adopts the registry model (currently `Mutation`; a future check follows the
 * same shape) shares one tested core instead of re-deriving it.
 *
 * Owns the three-field core every record carries (`id`/`version`/`justification`), the record's id
 * namespace, unknown-own-key rejection, and id uniqueness across the whole registry array. A
 * per-registry `ExceptionRegistrySchema` fills in everything registry-specific -- see
 * `checks/mutation.ts` for the `Mutation` check's own schema.
 */
import { mkdir } from "node:fs/promises"
import path from "node:path"
import {
  reconcileExceptions,
  writeExceptionRegistry,
  evaluateExceptionRecord,
} from "repo-contract/helpers"
import type {
  ExceptionClassification,
  ExceptionPolicy,
  ExceptionPolicyConfig,
  ExceptionRecordCore,
} from "repo-contract/helpers"

/**
 * A per-registry validator plugged into {@link validateExceptionRegistry} -- it owns everything
 * about one registry's own record shape beyond the three-field core every
 * `.repo-contract/exceptions/*.json` record shares.
 */
export interface ExceptionRegistrySchema<TRecord extends { readonly id: string }> {
  /** The mandatory `id` prefix for this registry, e.g. `"mutation:"`. A record whose id does not start with it is a namespace (integrity) failure, never a "stale" record. */
  readonly namespace: string
  /** Every own key a record of this registry may carry *beyond* the core `id`/`version`/`justification`. Any other own key fails validation. */
  readonly metadataKeys: readonly string[]
  /**
   * Validates `raw`'s registry-specific fields on top of the already-validated `core`, and
   * rebuilds the full typed record from scratch (never spreads `raw`). Pushes one message per
   * problem onto `errors` and returns `undefined` when any field is invalid.
   * @param core - The already-validated `id`/`version`/`justification`.
   * @param raw - The untrusted parsed object (all keys already confirmed to be in `metadataKeys` plus the core three).
   * @param index - The record's index in the registry array, for error messages.
   * @param errors - Accumulates every validation problem found across the whole registry.
   * @returns The freshly-rebuilt typed record, or `undefined` if any field was invalid.
   */
  readonly validateRecord: (
    core: ExceptionRecordCore,
    raw: Readonly<Record<string, unknown>>,
    index: number,
    errors: string[],
  ) => TRecord | undefined
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function validateOneExceptionRecord<TRecord extends { readonly id: string }>(
  entry: unknown,
  index: number,
  schema: ExceptionRegistrySchema<TRecord>,
  errors: string[],
): TRecord | undefined {
  if (!isPlainObject(entry)) {
    errors.push(`exceptions[${String(index)}] must be an object.`)
    return undefined
  }

  const allowedKeys = new Set<string>(["id", "version", "justification", ...schema.metadataKeys])
  const unknownKeys = Object.keys(entry).filter((key) => !allowedKeys.has(key))
  if (unknownKeys.length > 0) {
    errors.push(
      `exceptions[${String(index)}] has unrecognized field(s) ${unknownKeys.map((key) => JSON.stringify(key)).join(", ")} -- only ${[...allowedKeys].map((key) => JSON.stringify(key)).join(", ")} are permitted.`,
    )
  }

  const { id, version, justification } = entry

  const idValid =
    typeof id === "string" && id.startsWith(schema.namespace) && id.length > schema.namespace.length
  if (!idValid) {
    errors.push(
      `exceptions[${String(index)}].id must be a non-empty string beginning with ${JSON.stringify(schema.namespace)} (got ${JSON.stringify(id)}).`,
    )
  }

  const versionValid = version === 1
  if (!versionValid) {
    errors.push(
      `exceptions[${String(index)}].version must be the number 1 (got ${JSON.stringify(version)}).`,
    )
  }

  const justificationValid = typeof justification === "string"
  if (!justificationValid) {
    errors.push(`exceptions[${String(index)}].justification must be a string.`)
  }

  if (!idValid || !versionValid || !justificationValid || unknownKeys.length > 0) {
    return undefined
  }

  return schema.validateRecord({ id, version: 1, justification }, entry, index, errors)
}

/**
 * Validates an untrusted parsed value as one exception registry's `exceptions` array against
 * `schema`. Every problem found is reported (`ok: false` with the full list, never just the
 * first); a single bad record fails the whole registry rather than being silently dropped.
 * @param value - The parsed (otherwise untrusted) value -- expected to be an array of record objects.
 * @param schema - The per-registry schema (namespace, permitted metadata keys, field validator).
 * @returns Every valid, freshly-rebuilt record, or every validation error found.
 */
export function validateExceptionRegistry<TRecord extends { readonly id: string }>(
  value: unknown,
  schema: ExceptionRegistrySchema<TRecord>,
):
  | { readonly ok: true; readonly records: readonly TRecord[] }
  | { readonly ok: false; readonly errors: readonly string[] } {
  if (!Array.isArray(value)) {
    return {
      ok: false,
      errors: ['An exception registry\'s "exceptions" must be a JSON array of records.'],
    }
  }

  const errors: string[] = []
  const records: TRecord[] = []
  const seenIds = new Map<string, number>()

  for (const [index, entry] of value.entries()) {
    const record = validateOneExceptionRecord(entry, index, schema, errors)
    if (record === undefined) continue

    const firstIndex = seenIds.get(record.id)
    if (firstIndex !== undefined) {
      errors.push(
        `exceptions[${String(index)}] reuses the id ${JSON.stringify(record.id)} already held by exceptions[${String(firstIndex)}].`,
      )
      continue
    }
    seenIds.set(record.id, index)
    records.push(record)
  }

  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, records }
}

/**
 * The small, closed vocabulary of *why* a security-family exception (`SecuritySocket`,
 * `SecurityDeps`, ...) is deliberately tolerated -- ported from repo-contract's own
 * `scripts/shared/exception-record.ts` (unpublished there too; see this module's own header for
 * why the core validator is re-derived here rather than imported). Each retrofitted check may
 * narrow which members apply to it.
 *
 * - `"validated-false-positive"`: the finding does not actually apply here. Only satisfiable
 *   alongside `method: "mechanical-reverification"` -- re-running the same tool that raised the
 *   finding, scoped narrowly, and confirming it no longer fires. Never satisfiable by opinion
 *   alone.
 * - `"accepted-risk"`: the finding is real, and is knowingly tolerated.
 * - `"compensating-control"`: a different, already-in-place mitigation covers the same risk.
 * - `"tooling-limitation"`: the finding is an artifact of the scanning tool itself, not of this
 *   codebase's own behavior.
 * - `"scheduled-remediation"`: the fix is planned and tracked, not yet landed.
 * - `"platform-or-vendor-constraint"`: the finding cannot be resolved without a change outside
 *   this repository's own control (an upstream dependency, a platform API).
 */
export const EXCEPTION_TYPES = [
  "validated-false-positive",
  "accepted-risk",
  "compensating-control",
  "tooling-limitation",
  "scheduled-remediation",
  "platform-or-vendor-constraint",
] as const

export type ExceptionType = (typeof EXCEPTION_TYPES)[number]

/**
 * How an exception's claim was substantiated -- a required root field on every security-family
 * exception record.
 *
 * - `"mechanical-reverification"`: real, tool-backed evidence -- the same tool that raised the
 *   finding, re-run narrowly, confirms it no longer applies. The only method that can back
 *   `exceptionType: "validated-false-positive"`.
 * - `"independent-human-review"`: a human's own accountable judgment call -- covers everything
 *   mechanical re-verification cannot reach (an accepted-risk decision on a real, unfixable
 *   finding).
 */
const EXCEPTION_METHODS = ["mechanical-reverification", "independent-human-review"] as const

export type ExceptionMethod = (typeof EXCEPTION_METHODS)[number]

/** The four root fields every security-family exception record carries on top of the shared core (`id`/`version`/`justification`). */
export interface SecurityExceptionFields {
  readonly alternatives: string
  readonly remediation: string
  readonly method: "" | ExceptionMethod
  readonly exceptionType: "" | ExceptionType
}

/** The four {@link SecurityExceptionFields} key names, in canonical order -- every security-registry schema lists these among its `metadataKeys`. */
export const SECURITY_EXCEPTION_FIELD_KEYS = [
  "alternatives",
  "remediation",
  "method",
  "exceptionType",
] as const

/**
 * Validates the four {@link SecurityExceptionFields} on a candidate record: each a string;
 * `method` and `exceptionType` each either `""` or a recognized member; and the cross-field
 * refinement that a `"validated-false-positive"` claim, once its `method` is filled in at all,
 * must be `"mechanical-reverification"`. An all-empty stub passes -- completeness is the policy's
 * concern, not the validator's.
 * @param raw - The untrusted parsed record object.
 * @param index - The record's index in the registry array, for error messages.
 * @param allowedExceptionTypes - This registry's permitted `exceptionType` values.
 * @param errors - Accumulates every validation problem found.
 * @returns The four validated fields, or `undefined` if any was invalid.
 */
export function validateSecurityExceptionFields(
  raw: Readonly<Record<string, unknown>>,
  index: number,
  allowedExceptionTypes: readonly ExceptionType[],
  errors: string[],
): SecurityExceptionFields | undefined {
  const at = `exceptions[${String(index)}]`
  const { alternatives, remediation, method, exceptionType } = raw

  const alternativesValid = typeof alternatives === "string"
  if (!alternativesValid) errors.push(`${at}.alternatives must be a string.`)
  const remediationValid = typeof remediation === "string"
  if (!remediationValid) errors.push(`${at}.remediation must be a string.`)

  // Stryker disable ConditionalExpression: `typeof method === "string"` guarding
  // `.includes(method)` is an equivalent mutant when forced to `true` -- `Array.includes` on a
  // string array uses SameValueZero (no coercion), so a non-string `method` can never match any
  // element regardless of this guard. Hand-verified: forcing this to `true` leaves every test in
  // exception-record.test.ts passing unchanged.
  const methodValid =
    method === "" ||
    (typeof method === "string" && (EXCEPTION_METHODS as readonly string[]).includes(method))
  // Stryker restore ConditionalExpression
  if (!methodValid) {
    errors.push(
      `${at}.method must be "" or one of ${EXCEPTION_METHODS.map((m) => JSON.stringify(m)).join(", ")} (got ${JSON.stringify(method)}).`,
    )
  }

  // Stryker disable ConditionalExpression: `typeof exceptionType === "string"` guarding
  // `.includes(exceptionType)` is an equivalent mutant when forced to `true`, for the same reason
  // as the `method` guard above -- `Array.includes` never matches a non-string against a string
  // array. Hand-verified: forcing this to `true` leaves every test in exception-record.test.ts
  // passing unchanged.
  const exceptionTypeValid =
    exceptionType === "" ||
    (typeof exceptionType === "string" &&
      (allowedExceptionTypes as readonly string[]).includes(exceptionType))
  // Stryker restore ConditionalExpression
  if (!exceptionTypeValid) {
    errors.push(
      `${at}.exceptionType must be "" or one of ${allowedExceptionTypes.map((t) => JSON.stringify(t)).join(", ")} (got ${JSON.stringify(exceptionType)}).`,
    )
  }

  if (!alternativesValid || !remediationValid || !methodValid || !exceptionTypeValid) {
    return undefined
  }

  if (
    exceptionType === "validated-false-positive" &&
    method !== "" &&
    method !== "mechanical-reverification"
  ) {
    errors.push(
      `${at}: exceptionType "validated-false-positive" requires method "mechanical-reverification" (a false-positive claim rests on a re-run, not opinion); got method ${JSON.stringify(method)}.`,
    )
    return undefined
  }

  return {
    alternatives,
    remediation,
    method: method as SecurityExceptionFields["method"],
    exceptionType: exceptionType as SecurityExceptionFields["exceptionType"],
  }
}

/** `value` is a non-empty string -- pushes a `"<at> must be a non-empty string."` message onto `errors` otherwise. Shared identity-field validator every registry schema with a required string key (`package`, `type`, `range`, ...) uses. */
export function isValidNonEmptyStringField(
  value: unknown,
  at: string,
  errors: string[],
): value is string {
  const valid = typeof value === "string" && value.length > 0
  if (!valid) errors.push(`${at} must be a non-empty string.`)
  return valid
}

/** Reads one of `record`'s own string fields -- the `fieldValue` accessor both `evaluateExceptionRecord` and {@link evaluateFindingVerdict} take. Every exception record here is a flat, string-keyed shape, so this one generic accessor covers all of them. */
function genericFieldValue<TRecord>(record: TRecord, requirement: string): string {
  const value = (record as unknown as Record<string, unknown>)[requirement]
  return typeof value === "string" ? value : ""
}

/** Widens typed records to the flat shape `writeExceptionRegistry` (`repo-contract/helpers`) accepts -- TypeScript will not infer the implicit index signature through an `interface`. */
function asFlatExceptionRecords<TRecord extends { readonly id: string }>(
  records: readonly TRecord[],
): readonly (Record<string, unknown> & { readonly id: string })[] {
  return records as unknown as readonly (Record<string, unknown> & { readonly id: string })[]
}

/**
 * Evaluates one finding against its reconciled (possibly `undefined`, meaning the reconcile<->
 * evaluate bijection itself broke) record -- the `record === undefined -> "unmatched"`
 * short-circuit every security-family check needs before it can even call
 * `evaluateExceptionRecord`, shared so each check only supplies its own classification.
 * @param record - This finding's reconciled active record, or `undefined` for a bijection failure.
 * @param classifications - This finding's own `{ group, category }` classification(s).
 * @param config - The check's own `ExceptionPolicyConfig`.
 * @param globalDefault - The check's own fallback policy for an unmatched classification.
 */
export function evaluateFindingVerdict<TRecord>(
  record: TRecord | undefined,
  classifications: readonly [ExceptionClassification, ...ExceptionClassification[]],
  config: ExceptionPolicyConfig,
  globalDefault: ExceptionPolicy,
): {
  readonly verdict: "forbidden" | "insufficient" | "permitted" | "unmatched"
  readonly missing: readonly string[]
} {
  if (record === undefined) return { verdict: "unmatched", missing: [] }
  const determinant = evaluateExceptionRecord({
    record,
    classifications,
    config,
    globalDefault,
    fieldValue: genericFieldValue,
  })
  return { verdict: determinant.verdict, missing: determinant.missing }
}

/** The registry state a batch of findings reconciled against, once persisted back to disk. */
export interface PersistedExceptionRegistry<TRecord> {
  readonly activeRecords: readonly TRecord[]
  readonly staleRecords: readonly TRecord[]
  readonly newStubIds: readonly string[]
}

/**
 * Reconciles `findings` against `existing` records and writes the result back to `registryPath`
 * -- the one place any security-family check ever mutates the consumer's own tree. Shared by
 * `SecuritySocket` and `SecurityDeps`; every check supplies only its own finding/record types and
 * `createStub`.
 * @param registryRelativePath - The registry's own repo-relative path, for error messages only.
 */
export async function reconcileAndPersistExceptionRegistry<
  TFinding extends { readonly id: string },
  TRecord extends { readonly id: string },
>(
  registryPath: string,
  registryRelativePath: string,
  existing: readonly TRecord[],
  findings: readonly TFinding[],
  createStub: (finding: TFinding, id: string) => TRecord,
): Promise<
  | { readonly ok: true; readonly registry: PersistedExceptionRegistry<TRecord> }
  | { readonly ok: false; readonly rationale: string }
> {
  const reconciled = reconcileExceptions<TFinding, TRecord>({
    existing,
    findings,
    deriveId: (finding) => finding.id,
    createStub,
  })
  if (!reconciled.ok) {
    return {
      ok: false,
      rationale: `${registryRelativePath} could not be reconciled: ${reconciled.error}`,
    }
  }
  const { activeRecords, staleRecords, newStubIds } = reconciled.reconciliation

  try {
    await mkdir(path.dirname(registryPath), { recursive: true })
    const write = await writeExceptionRegistry({
      path: registryPath,
      records: asFlatExceptionRecords([...activeRecords, ...staleRecords]),
    })
    if (!write.ok) {
      return { ok: false, rationale: `Writing ${registryRelativePath} failed: ${write.error}` }
    }
  } catch (error) {
    return {
      ok: false,
      rationale: `Could not write ${registryRelativePath}: ${(error as Error).message}`,
    }
  }

  return { ok: true, registry: { activeRecords, staleRecords, newStubIds } }
}
