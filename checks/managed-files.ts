/**
 * `ManagedFiles`: the files this package owns in a consumer still mean what the standard's copies
 * mean.
 *
 * Reads: the consumer's release, pin-sync, env-rotation and Scorecard workflows, its Changesets
 * config, and every managed copy it enrolled. `scripts/check-managed-files.mjs` and
 * `scripts/managed-files/inspect.mjs` compare them with this package's templates. When something
 * differs, also `.repo-contract/exceptions/managed-files.json`. Wording, comments and the pinned
 * commit are ignored. Every other scaffolded file belongs to the consumer and is never judged.
 *
 * Fails on a managed file that is missing or drifted and has no complete, unexpired record. Fails
 * when the registry cannot be loaded. Never warns. Passes for a private package, which owns no
 * files in a consumer.
 *
 * Exceptions: id `managed-file:<path>` with a `path` field and the version 2 fields. Or run
 * `internal-package-contract sync` to see the difference, and `sync --apply --update` to restore
 * the file.
 *
 * Runs in the consumer `contract` job and in both git hooks. IPC's own self-contract leaves it out:
 * this repository is the source of the files, not a consumer.
 *
 * Example record:
 *
 * ```json
 * {
 *   "exceptions": [
 *     {
 *       "id": "managed-file:.github/workflows/scorecard.yml",
 *       "version": 2,
 *       "justification": "The Scorecard workflow runs weekly here, not daily: the package changes rarely.",
 *       "path": ".github/workflows/scorecard.yml",
 *       "ruleBroken": "A managed workflow keeps the standard's trigger.",
 *       "attempted": "The standard's daily schedule; it exhausted the API quota shared with the benchmarks.",
 *       "constraint": "One quota serves every workflow of the repository.",
 *       "whyPreferable": "A weekly score stays current for a package released a few times a year.",
 *       "residualRisk": "A regression in the score is seen up to a week later.",
 *       "revisitWhen": "The package starts releasing weekly, or the quota is raised.",
 *       "expires": ""
 *     }
 *   ]
 * }
 * ```
 */
import path from "node:path"
import { loadExceptionRegistry } from "repo-contract/helpers"
import type { ExceptionRecordCore, StandardSchemaV1 } from "repo-contract/helpers"
import type { CheckDefinitionConfig, PolicyResult } from "repo-contract"
import { missingFields } from "../scripts/exception-fields.mjs"
import { isValidNonEmptyStringField, validateExceptionRegistry } from "./exception-record.js"
import type { ExceptionRegistrySchema, ExceptionV2Fields } from "./exception-record.js"
import { packageRoot, parseToolEnvelope } from "./shared.js"

const scriptPath = path.join(packageRoot, "scripts", "check-managed-files.mjs")

/** Where a repository records the managed files it deliberately differs on. */
export const MANAGED_FILES_REGISTRY_PATH = ".repo-contract/exceptions/managed-files.json"

/** One `.repo-contract/exceptions/managed-files.json` record. */
export interface ManagedFileRecord extends Partial<ExceptionV2Fields> {
  readonly id: string
  readonly version: 1 | 2
  readonly justification: string
  readonly path: string
}

/** @param file - a managed file's path in the consumer. @returns the id of the record that accepts it. */
export function managedFileId(file: string): string {
  return `managed-file:${file}`
}

/** @internal Exported for direct unit coverage. */
export const MANAGED_FILE_SCHEMA: ExceptionRegistrySchema<ManagedFileRecord> = {
  namespace: "managed-file:",
  metadataKeys: ["path"],
  validateRecord(core: ExceptionRecordCore, raw, index, errors) {
    const at = `exceptions[${String(index)}]`
    const file = raw["path"]
    if (!isValidNonEmptyStringField(file, `${at}.path`, errors)) return undefined
    const derived = managedFileId(file)
    if (derived !== core.id) {
      errors.push(
        `${at}.id ${JSON.stringify(core.id)} does not match the id derived from its own path (${JSON.stringify(derived)}).`,
      )
      return undefined
    }
    return { id: core.id, version: 1, justification: core.justification, path: file }
  },
}

const registrySchema: StandardSchemaV1<unknown, readonly ManagedFileRecord[]> = {
  "~standard": {
    version: 1,
    vendor: "internal-package-contract",
    validate: (value: unknown) => {
      const result = validateExceptionRegistry(value, MANAGED_FILE_SCHEMA)
      return result.ok
        ? { value: result.records }
        : { issues: result.errors.map((message) => ({ message })) }
    },
  },
}

interface ManagedReport {
  readonly ok: boolean
  readonly state: "exempt" | "current" | "problem"
  readonly files: readonly { readonly to: string; readonly state: "missing" | "drifted" }[]
}

/**
 * @param input - Test seam: the clock and repository root the registry is read against.
 * @param input.cwd - The repository root; defaults to the working directory.
 * @param input.now - The clock `expires` is compared against; defaults to now.
 * @returns the `ManagedFiles` check.
 */
export function managedFilesCheck(
  input: { readonly cwd?: string; readonly now?: Date } = {},
): CheckDefinitionConfig {
  return {
    run: ["node", scriptPath],
    output: { format: "json" },
    policy: async ({ result }): Promise<PolicyResult> => {
      const envelope = parseToolEnvelope<ManagedReport>(
        result,
        "check-managed-files",
        "ManagedFiles:",
      )
      if (!envelope.ok) return envelope.result
      const { state, files } = envelope.value
      if (state === "exempt") {
        return {
          outcome: "pass",
          rationale: "ManagedFiles: this package is private, so it owns no files in a consumer.",
        }
      }
      if (state === "current") {
        return {
          outcome: "pass",
          rationale: "ManagedFiles: every file this package owns matches the standard.",
        }
      }
      const loaded = await loadExceptionRegistry({
        path: path.join(input.cwd ?? process.cwd(), MANAGED_FILES_REGISTRY_PATH),
        schema: registrySchema,
      })
      if (!loaded.ok) {
        return {
          outcome: "fail",
          rationale: [
            `ManagedFiles: ${MANAGED_FILES_REGISTRY_PATH} failed to load, so a drifted file cannot be judged:`,
            ...loaded.errors.map((error) => `- ${error}`),
          ].join("\n"),
        }
      }
      const now = input.now ?? new Date()
      const byId = new Map(loaded.records.map((record) => [record.id, record]))
      const accepted: string[] = []
      const unaccepted: string[] = []
      for (const { to, state: fileState } of files) {
        const id = managedFileId(to)
        const record = byId.get(id)
        if (record === undefined) {
          unaccepted.push(`${to} is ${fileState}; add ${id} to accept it`)
          continue
        }
        const missing = missingFields(record as unknown as Record<string, unknown>, now)
        if (missing.length === 0) accepted.push(`${to} is ${fileState}, accepted by ${id}`)
        else {
          unaccepted.push(
            `${to} is ${fileState}; complete ${id} (missing: ${missing.join(", ")}) to accept it`,
          )
        }
      }
      if (unaccepted.length > 0) {
        return {
          outcome: "fail",
          rationale: [
            `ManagedFiles: ${String(unaccepted.length)} file(s) this package owns do not match the standard. Run \`internal-package-contract sync\` to see the difference and \`sync --apply --update\` to restore them, or record why each differs in ${MANAGED_FILES_REGISTRY_PATH}:`,
            ...unaccepted.map((line) => `- ${line}`),
          ].join("\n"),
        }
      }
      return {
        outcome: "pass",
        rationale: [
          `ManagedFiles: ${String(accepted.length)} managed file(s) differ from the standard, each accepted by a reviewed record:`,
          ...accepted.map((line) => `- ${line}`),
        ].join("\n"),
      }
    },
  }
}
