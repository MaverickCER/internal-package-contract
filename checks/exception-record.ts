/**
 * The generic, check-owned exception-registry validator every `.repo-contract/exceptions/*.json`
 * file in a CONSUMER repository shares -- the layer `repo-contract/helpers`' own
 * specs/decisions/0013-reusable-exception-policy-helper.md deliberately leaves unpublished
 * ("Not published; an outside consumer wanting it writes their own"), ported here so every check
 * in this package that adopts the registry model (`Mutation`, `SecuritySocket`, `SecurityDeps`,
 * `CodeScanning`, `DistNoUrls`, `CodeRabbit` and the environment-precondition registry) shares one
 * tested core instead of re-deriving it.
 *
 * Owns the core every record carries (`id`/`version`/`justification`, plus -- on a `version: 2`
 * record -- the structured fields in {@link EXCEPTION_V2_FIELD_KEYS} that say what rule is being
 * broken and why), the record's id namespace, unknown-own-key rejection, and id uniqueness across
 * the whole registry array. A per-registry `ExceptionRegistrySchema` fills in everything
 * registry-specific -- see `checks/mutation.ts` for the `Mutation` check's own schema.
 */
import { mkdir } from "node:fs/promises"
import path from "node:path"
import {
  loadExceptionRegistry,
  reconcileExceptions,
  writeExceptionRegistry,
  evaluateExceptionRecord,
} from "repo-contract/helpers"
import type {
  ExceptionClassification,
  ExceptionPolicy,
  ExceptionPolicyConfig,
  ExceptionRecordCore,
  StandardSchemaV1,
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

/**
 * The fields a `version: 2` exception record carries on top of `id`/`version`/`justification`
 * (and any registry-specific ones). Together they are what makes an exception auditable: which
 * rule is being broken, what was tried first, the technical constraint that forced the exception,
 * why the chosen outcome is preferable to the alternatives, what risk remains, and the condition
 * under which the record must be reopened. `expires` is an optional hard date (`YYYY-MM-DD`, or
 * `""` for none) after which the record no longer counts.
 */
export const EXCEPTION_V2_FIELD_KEYS = [
  "ruleBroken",
  "attempted",
  "constraint",
  "whyPreferable",
  "residualRisk",
  "revisitWhen",
] as const

/** The {@link EXCEPTION_V2_FIELD_KEYS} plus the optional `expires` date -- every key a v2 record may carry beyond its registry's own. */
const EXCEPTION_V2_ALL_KEYS = [...EXCEPTION_V2_FIELD_KEYS, "expires"] as const

/** The version-2 fields of an exception record; every one is an empty string on a freshly scaffolded stub until a human writes it. */
export interface ExceptionV2Fields {
  readonly ruleBroken: string
  readonly attempted: string
  readonly constraint: string
  readonly whyPreferable: string
  readonly residualRisk: string
  readonly revisitWhen: string
  readonly expires: string
}

/** Every v2 field blank -- what a newly scaffolded stub starts with. */
export function emptyV2Fields(): ExceptionV2Fields {
  return {
    ruleBroken: "",
    attempted: "",
    constraint: "",
    whyPreferable: "",
    residualRisk: "",
    revisitWhen: "",
    expires: "",
  }
}

/**
 * A record that carries the optional version-2 structure. `version: 1` records (the legacy shape)
 * have none of the {@link ExceptionV2Fields}; both versions are accepted so a registry can migrate
 * record by record, and the inventory reports how many legacy records remain.
 */
export interface VersionedExceptionRecord {
  readonly id: string
  readonly version: 1 | 2
}

/** Whether `record` is a legacy `version: 1` record. */
export function isLegacyRecord(record: { readonly version: 1 | 2 }): boolean {
  return record.version === 1
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Whether an `expires` value (`YYYY-MM-DD`) is in the past relative to `now`.
 * @param expires - The record's `expires` string (`""` means it never expires).
 * @param now - The clock to compare against.
 * @returns `true` only for a valid date strictly before today's date.
 */
export function isExpired(expires: string, now: Date = new Date()): boolean {
  if (expires === "" || !ISO_DATE.test(expires)) return false
  return expires < now.toISOString().slice(0, 10)
}

function validateV2Fields(
  entry: Readonly<Record<string, unknown>>,
  index: number,
  errors: string[],
): ExceptionV2Fields | undefined {
  const at = `exceptions[${String(index)}]`
  let ok = true
  for (const key of EXCEPTION_V2_FIELD_KEYS) {
    if (typeof entry[key] !== "string") {
      errors.push(`${at}.${key} must be a string (a version 2 record carries it).`)
      ok = false
    }
  }
  const expires = entry["expires"]
  if (typeof expires !== "string" || (expires !== "" && !ISO_DATE.test(expires))) {
    errors.push(`${at}.expires must be "" or a YYYY-MM-DD date (got ${JSON.stringify(expires)}).`)
    ok = false
  }
  if (!ok) return undefined
  return Object.fromEntries(
    EXCEPTION_V2_ALL_KEYS.map((key) => [key, entry[key] as string]),
  ) as unknown as ExceptionV2Fields
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
  if (entry["version"] === 2) for (const key of EXCEPTION_V2_ALL_KEYS) allowedKeys.add(key)
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

  const versionValid = version === 1 || version === 2
  if (!versionValid) {
    errors.push(
      `exceptions[${String(index)}].version must be the number 2 (or the legacy 1) (got ${JSON.stringify(version)}).`,
    )
  }

  const justificationValid = typeof justification === "string"
  if (!justificationValid) {
    errors.push(`exceptions[${String(index)}].justification must be a string.`)
  }

  if (!idValid || !versionValid || !justificationValid || unknownKeys.length > 0) {
    return undefined
  }

  const v2 = version === 2 ? validateV2Fields(entry, index, errors) : undefined
  if (version === 2 && v2 === undefined) return undefined

  const record = schema.validateRecord({ id, version: 1, justification }, entry, index, errors)
  if (record === undefined || v2 === undefined) return record
  // The registry's own validator rebuilds the record at version 1; a v2 record keeps its version
  // and carries its structured fields alongside the registry-specific ones.
  return { ...record, version: 2, ...v2 } as unknown as TRecord
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
 * - `"required-for-package-to-exist"`: the package cannot exist at all without the flagged
 *   dependency or behavior -- removing it would remove the package's purpose. The only type
 *   `SecuritySocket` accepts.
 * - `"dev-only-not-shipped"`: the finding is in development-only code (tests, scripts, docs, CI
 *   configuration) that never reaches a build, a runtime or a published package. The only type
 *   `CodeScanning` accepts.
 */
export const EXCEPTION_TYPES = [
  "validated-false-positive",
  "accepted-risk",
  "compensating-control",
  "tooling-limitation",
  "scheduled-remediation",
  "platform-or-vendor-constraint",
  "required-for-package-to-exist",
  "dev-only-not-shipped",
] as const

export type ExceptionType = (typeof EXCEPTION_TYPES)[number]

/**
 * The exception types `SecuritySocket` accepts. Critical and high alerts are never waivable at
 * all (policy, not type); for everything else the type must say what is actually true -- the
 * alert is a heuristic that does not apply (`validated-false-positive`, re-verified mechanically),
 * an artifact of the scanner (`tooling-limitation`), a real but tolerated property
 * (`accepted-risk`), or the dependency is why the package exists
 * (`required-for-package-to-exist`).
 */
export const SOCKET_EXCEPTION_TYPES: readonly ExceptionType[] = [
  "validated-false-positive",
  "tooling-limitation",
  "accepted-risk",
  "required-for-package-to-exist",
]

/** The only exception type `CodeScanning` accepts: the finding is in code that is never shipped. */
export const CODE_SCANNING_EXCEPTION_TYPES: readonly ExceptionType[] = ["dev-only-not-shipped"]

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
 * - `"policy-rule"`: no individual judged this record -- a standing rule of this standard decided
 *   it (for example `CodeScanning` rejecting every alert in development-only code by location).
 *   The record says so rather than asserting a review that never happened.
 */
const EXCEPTION_METHODS = [
  "mechanical-reverification",
  "independent-human-review",
  "policy-rule",
] as const

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

/**
 * Reads one of `record`'s own string fields -- the `fieldValue` accessor both `evaluateExceptionRecord`
 * and {@link evaluateFindingVerdict} take. Every exception record here is a flat, string-keyed shape,
 * so this one generic accessor covers all of them. A legacy `version: 1` record has none of the
 * structured {@link EXCEPTION_V2_FIELD_KEYS}; for those it answers {@link LEGACY_FIELD_VALUE} so the
 * record stays valid until it is migrated, while a `version: 2` record must really have written them.
 */
export function recordFieldValue<TRecord>(record: TRecord, requirement: string): string {
  const flat = record as unknown as Record<string, unknown>
  const value = flat[requirement]
  if (typeof value === "string") return value
  const isV2Field = (EXCEPTION_V2_FIELD_KEYS as readonly string[]).includes(requirement)
  return isV2Field && flat["version"] === 1 ? LEGACY_FIELD_VALUE : ""
}

/** What a legacy record reports for a structured field it never had (non-empty, so a v1 record still satisfies a v2 requirement). */
export const LEGACY_FIELD_VALUE = "(legacy version 1 record)"

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
    fieldValue: recordFieldValue,
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

/**
 * Loads a registry from disk, reconciles `findings` against it and persists the result -- the
 * whole "read, reconcile, write back" sequence every registry-backed check performs, in one place.
 * @param registryPath - Absolute path of the registry file.
 * @param registryRelativePath - The registry's repo-relative path, for rationales.
 * @param schema - Validates the file's records.
 * @param findings - This run's findings.
 * @param createStub - Builds a blank record for a finding with none yet.
 * @returns the reconciled registry, or the failure rationale to return verbatim.
 */
export async function loadAndReconcileExceptionRegistry<
  TFinding extends { readonly id: string },
  TRecord extends { readonly id: string },
>(
  registryPath: string,
  registryRelativePath: string,
  schema: StandardSchemaV1<unknown, readonly TRecord[]>,
  findings: readonly TFinding[],
  createStub: (finding: TFinding, id: string) => TRecord,
): Promise<
  | { readonly ok: true; readonly registry: PersistedExceptionRegistry<TRecord> }
  | { readonly ok: false; readonly rationale: string }
> {
  const loaded = await loadExceptionRegistry({ path: registryPath, schema })
  if (!loaded.ok) {
    return {
      ok: false,
      rationale: [
        `${registryRelativePath} failed to load and was left unchanged:`,
        ...loaded.errors.map((error) => `- ${error}`),
      ].join("\n"),
    }
  }
  return reconcileAndPersistExceptionRegistry(
    registryPath,
    registryRelativePath,
    loaded.records,
    findings,
    createStub,
  )
}
