/**
 * The exception registry for "this check could not run here" -- the question every non-normal
 * outcome has to answer ("a link that linkinator could not reach because of rate limiting",
 * "CodeRabbit has no CLI in CI", "no Chrome to run pa11y"): is it acceptable, and who said so?
 *
 * A check that cannot evaluate its subject no longer degrades to a bare `warn`. It calls
 * {@link degraded}, which always records the degradation in the verdict and then:
 *
 * - **accepted** -- a complete record `environment:<Check>:<code>` exists in
 *   `.repo-contract/exceptions/environment.json`: `warn`, class `not-evaluated`.
 * - **unexcepted** -- no complete record covers it: `warn` with a rationale that names the id to
 *   add, class `unexcepted`. A local run stays usable, while the CI gate (`--strict`, the default
 *   under `CI`) fails the run until someone writes down why it is acceptable.
 *
 * Example record (the structured fields are the same ones every other registry requires):
 *
 * ```json
 * {
 *   "exceptions": [
 *     {
 *       "id": "environment:CodeRabbit:ci",
 *       "version": 2,
 *       "justification": "CodeRabbit reviews pull requests as a GitHub App; its CLI is not installed in CI.",
 *       "check": "CodeRabbit",
 *       "code": "ci",
 *       "ruleBroken": "CodeRabbit findings must be addressed or recorded before merge.",
 *       "attempted": "Installing the CLI in the workflow needs a CodeRabbit API key we do not issue to CI.",
 *       "constraint": "The CLI reviews uncommitted edits locally; in CI the review is the GitHub App's.",
 *       "whyPreferable": "Branch protection requires resolved review threads, so the App's findings still block a merge.",
 *       "residualRisk": "A finding the App never raised is not seen; the same is true of any reviewer.",
 *       "revisitWhen": "CodeRabbit ships a CI mode for the CLI, or the App is uninstalled.",
 *       "expires": ""
 *     }
 *   ]
 * }
 * ```
 */
import path from "node:path"
import { loadExceptionRegistry } from "repo-contract/helpers"
import type { ExceptionRecordCore, StandardSchemaV1 } from "repo-contract/helpers"
import type { PolicyResult } from "repo-contract"
import { NOT_EVALUATED_ACCEPTED, NOT_EVALUATED_UNEXCEPTED } from "../scripts/contract-report.mjs"
import {
  EXCEPTION_V2_FIELD_KEYS,
  isExpired,
  isValidNonEmptyStringField,
  validateExceptionRegistry,
} from "./exception-record.js"
import type { ExceptionRegistrySchema, ExceptionV2Fields } from "./exception-record.js"

/** Where a repository records the degradations it accepts. */
export const ENVIRONMENT_REGISTRY_RELATIVE_PATH = ".repo-contract/exceptions/environment.json"

/** One `.repo-contract/exceptions/environment.json` record. */
export interface EnvironmentExceptionRecord extends Partial<ExceptionV2Fields> {
  readonly id: string
  readonly version: 1 | 2
  readonly justification: string
  readonly check: string
  readonly code: string
}

/**
 * `environment:<Check>:<code>` -- the check and the machine-readable reason it could not run.
 * @param check - The check's id, e.g. `"CodeRabbit"`.
 * @param code - Why it could not run, e.g. `"ci"` or `"no-chrome"`.
 * @returns The record id that accepts this degradation.
 */
export function environmentExceptionId(check: string, code: string): string {
  return `environment:${check}:${code}`
}

/** @internal Exported for direct unit coverage. */
export const ENVIRONMENT_EXCEPTION_SCHEMA: ExceptionRegistrySchema<EnvironmentExceptionRecord> = {
  namespace: "environment:",
  metadataKeys: ["check", "code"],
  validateRecord(core: ExceptionRecordCore, raw, index, errors) {
    const at = `exceptions[${String(index)}]`
    const { check, code } = raw
    const checkValid = isValidNonEmptyStringField(check, `${at}.check`, errors)
    const codeValid = isValidNonEmptyStringField(code, `${at}.code`, errors)
    if (!checkValid || !codeValid) return undefined
    const derived = environmentExceptionId(check, code)
    if (derived !== core.id) {
      errors.push(
        `${at}.id ${JSON.stringify(core.id)} does not match the id derived from its own check and code (${JSON.stringify(derived)}).`,
      )
      return undefined
    }
    return { id: core.id, version: 1, justification: core.justification, check, code }
  },
}

const registrySchema: StandardSchemaV1<unknown, readonly EnvironmentExceptionRecord[]> = {
  "~standard": {
    version: 1,
    vendor: "internal-package-contract",
    validate: (value: unknown) => {
      const result = validateExceptionRegistry(value, ENVIRONMENT_EXCEPTION_SCHEMA)
      return result.ok
        ? { value: result.records }
        : { issues: result.errors.map((message) => ({ message })) }
    },
  },
}

/**
 * What is missing from `record` for it to count as an accepted exception -- an empty list means it
 * is complete and unexpired.
 * @param record - The registry record.
 * @param now - The clock `expires` is compared against.
 * @returns The names of the problems, in a stable order.
 */
export function incompleteFields(
  record: { readonly justification: string } & Partial<ExceptionV2Fields>,
  now: Date,
): string[] {
  const flat = record as unknown as Record<string, unknown>
  const missing: string[] = []
  if (record.justification.trim() === "") missing.push("justification")
  for (const key of EXCEPTION_V2_FIELD_KEYS) {
    const value = flat[key]
    if (typeof value !== "string" || value.trim() === "") missing.push(key)
  }
  if (typeof record.expires === "string" && isExpired(record.expires, now)) {
    missing.push(`expires (${record.expires} has passed)`)
  }
  return missing
}

/**
 * Records that a check could not evaluate its subject, and says whether that is accepted.
 * @param input - What could not run.
 * @param input.check - The check's id, e.g. `"CodeRabbit"`.
 * @param input.code - A short, stable reason code, e.g. `"ci"` or `"no-chrome"`. Pass `codes`
 *   instead when one run degraded for several independent reasons (every unreachable URL, say):
 *   all of them must be accepted for the result to count as accepted.
 * @param input.rationale - The human-readable reason, including what to do to enable the check.
 * @param input.cwd - The repository root; defaults to the working directory.
 * @param input.now - The clock; defaults to now.
 * @returns A `warn` whose rationale starts with the accepted or unexcepted marker, or a `fail`
 *   when the registry itself is malformed.
 */
export async function degraded(input: {
  readonly check: string
  readonly code?: string
  readonly codes?: readonly string[]
  readonly rationale: string
  readonly cwd?: string
  readonly now?: Date
}): Promise<PolicyResult> {
  const codes = input.codes ?? (input.code === undefined ? [] : [input.code])
  const ids = codes.map((code) => environmentExceptionId(input.check, code))
  const loaded = await loadExceptionRegistry({
    path: path.join(input.cwd ?? process.cwd(), ENVIRONMENT_REGISTRY_RELATIVE_PATH),
    schema: registrySchema,
  })
  if (!loaded.ok) {
    return {
      outcome: "fail",
      rationale: [
        `${ENVIRONMENT_REGISTRY_RELATIVE_PATH} failed to load, so "${input.check} could not run" cannot be judged:`,
        ...loaded.errors.map((error) => `- ${error}`),
      ].join("\n"),
    }
  }
  const byId = new Map(loaded.records.map((record) => [record.id, record]))
  const now = input.now ?? new Date()
  const unaccepted: string[] = []
  for (const id of ids) {
    const record = byId.get(id)
    if (record === undefined) {
      unaccepted.push(`${id} (no record)`)
      continue
    }
    const missing = incompleteFields(record, now)
    if (missing.length > 0) unaccepted.push(`${id} (missing: ${missing.join(", ")})`)
  }
  if (unaccepted.length > 0) {
    return {
      outcome: "warn",
      rationale: `${NOT_EVALUATED_UNEXCEPTED}; add or complete in ${ENVIRONMENT_REGISTRY_RELATIVE_PATH}: ${unaccepted.join("; ")}): ${input.rationale}`,
    }
  }
  return {
    outcome: "warn",
    rationale: `${NOT_EVALUATED_ACCEPTED} ${ids.join(", ")}): ${input.rationale}`,
  }
}
