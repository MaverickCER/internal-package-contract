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
import type { ExceptionRecordCore } from "repo-contract/helpers"

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
