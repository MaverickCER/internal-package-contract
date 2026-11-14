/**
 * The JSON shape `scripts/coderabbitai/review.ts` prints and `checks/coderabbitai.ts` reads. The script runs
 * the installed CodeRabbit CLI, normalizes its `--agent` event stream into these findings, and reconciles
 * `.repo-contract/exceptions/coderabbit.json` against them when a review ran. The policy reads the result and
 * re-derives nothing.
 *
 * A `finding` event carries `severity`, `fileName` and `codegenInstructions`; it has no line, category or id of
 * its own. The summary is AI prose and can change between reviews of the same diff. The id is therefore
 * `coderabbit:<file>:<severity>:<hash of summary>`: distinct within a run, and stale as soon as the wording
 * changes, which is when a person should re-confirm the record.
 *
 * The four authoring fields a record carries (`alternatives`, `remediation`, `method`, `exceptionType`) come
 * from this package's own `checks/exception-record.ts`; repo-contract does not publish its equivalent.
 */

import type { ExceptionV2Fields, SecurityExceptionFields } from "../../checks/exception-record.js"

export interface NormalizedFinding {
  /** `coderabbit:<file>:<severity>:<hash>`: see `deriveCoderabbitExceptionId`. */
  readonly id: string
  readonly file: string
  /** A recognized event carrying a severity value this wrapper doesn't recognize -> `"unknown"` (still evaluated). A structurally malformed event is `status: "error"` instead. */
  readonly severity: "critical" | "major" | "minor" | "unknown"
  /** The finding's own descriptive text, verbatim from `codegenInstructions`: untrusted, AI-generated content; never executed or templated, only ever displayed. */
  readonly summary: string
}

/** One `.repo-contract/exceptions/coderabbit.json` record: the on-disk exception record shape. */
export interface CoderabbitExceptionRecord
  extends SecurityExceptionFields, Partial<ExceptionV2Fields> {
  /** `coderabbit:<file>:<severity>:<hash of summary>`: must equal `deriveCoderabbitExceptionId(record)`. */
  readonly id: string
  readonly version: 1 | 2
  /** Why this CodeRabbit finding is deliberately not acted on, and confirmation it was actually examined (not dismissed unread). */
  readonly justification: string
  readonly file: string
  readonly severity: NormalizedFinding["severity"]
  /** The finding's descriptive text at the time the waiver was written: what the human read and judged. If CodeRabbit's wording changes, the finding id changes and this record goes stale (re-review). */
  readonly summary: string
}

export type CoderabbitEvidence =
  | {
      readonly status: "reviewed"
      readonly registryPath: string
      readonly findings: readonly NormalizedFinding[]
      readonly activeExceptions: Readonly<Record<string, CoderabbitExceptionRecord>>
      readonly staleExceptions: readonly CoderabbitExceptionRecord[]
      readonly scaffoldedIds: readonly string[]
      readonly registryError?: readonly string[]
    }
  | {
      readonly status: "not-applicable"
      readonly reason: "ci"
      readonly expectedProvider: "coderabbit-github-app"
      readonly registryPath: string
      readonly existingRecordCount: number
      readonly registryError?: readonly string[]
    }
  | {
      readonly status: "unavailable"
      readonly reason:
        "cli-not-installed" | "git-context-unavailable" | "not-signed-in" | "network-unreachable"
      readonly registryPath: string
      readonly existingRecordCount: number
      readonly registryError?: readonly string[]
    }
  | {
      readonly status: "error"
      readonly message: string
      readonly registryPath: string
      readonly existingRecordCount: number
      readonly registryError?: readonly string[]
    }
