/**
 * Shapes for the `CodeRabbit` check -- `scripts/coderabbitai/review.ts` normalizes the real,
 * installed CodeRabbit CLI's own `--agent` structured event stream into this model, reconciles the
 * consumer's `.repo-contract/exceptions/coderabbit.json` against the findings it produced (only
 * when a review actually ran), and `checks/coderabbitai.ts`'s policy reads (never re-derives) the
 * result. A generic recreation of repo-contract's own `scripts/coderabbitai/evidence-types.ts` --
 * see that repo's specs/decisions/0014-coderabbit-as-a-surfaced-check.md and
 * specs/decisions/0013-reusable-exception-policy-helper.md for the design this mirrors.
 *
 * Confirmed real `finding` event shape: `{severity, fileName, codegenInstructions, suggestions}` --
 * **no** `line`, **no** `category`, **no** native finding-id. `codegenInstructions` is a free-text
 * block; `review.ts` keeps it as `summary`. Because the CLI provides no stable finding id and the
 * summary prose is AI-generated (not guaranteed byte-stable across re-reviews of an unchanged
 * diff), the finding `id` is `coderabbit:<file>:<severity>:<hash of summary>` -- injective over a
 * run, and deliberately churny across re-reviews whose prose changed (that is exactly when a human
 * should re-confirm any waiver still applies).
 *
 * The four security-family authoring fields a record carries come from this package's own
 * `checks/exception-record.ts` ({@link SecurityExceptionFields}), not from repo-contract:
 * repo-contract keeps its equivalent in an unpublished `scripts/shared/` module (ADR 0013's
 * deliberate "not published" boundary), so there is nothing importable to reuse.
 */

import type { SecurityExceptionFields } from "../../checks/exception-record.js"

export interface NormalizedFinding {
  /** `coderabbit:<file>:<severity>:<hash>` -- see `deriveCoderabbitExceptionId`. */
  readonly id: string
  readonly file: string
  /** A recognized event carrying a severity value this wrapper doesn't recognize -> `"unknown"` (still evaluated). A structurally malformed event is `status: "error"` instead. */
  readonly severity: "critical" | "major" | "minor" | "unknown"
  /** The finding's own descriptive text, verbatim from `codegenInstructions` -- untrusted, AI-generated content; never executed or templated, only ever displayed. */
  readonly summary: string
}

/** One `.repo-contract/exceptions/coderabbit.json` record -- the on-disk exception record shape. */
export interface CoderabbitExceptionRecord extends SecurityExceptionFields {
  /** `coderabbit:<file>:<severity>:<hash of summary>` -- must equal `deriveCoderabbitExceptionId(record)`. */
  readonly id: string
  readonly version: 1
  /** Why this CodeRabbit finding is deliberately not acted on, and confirmation it was actually examined (not dismissed unread). */
  readonly justification: string
  readonly file: string
  readonly severity: NormalizedFinding["severity"]
  /** The finding's descriptive text at the time the waiver was written -- what the human read and judged. If CodeRabbit's wording changes, the finding id changes and this record goes stale (re-review). */
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
      readonly reason: "cli-not-installed" | "git-context-unavailable"
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
