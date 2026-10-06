/**
 * The `.repo-contract/exceptions/coderabbit.json` registry schema, its canonical id derivation, and
 * the blank stub `review.ts` scaffolds for a newly-seen finding -- a generic recreation of
 * repo-contract's own `scripts/coderabbitai/registry.ts`, rebuilt on this package's own
 * `checks/exception-record.ts` core (repo-contract keeps its equivalent unpublished; see that
 * module's own header).
 */
import { createHash } from "node:crypto"
import {
  EXCEPTION_TYPES,
  SECURITY_EXCEPTION_FIELD_KEYS,
  emptyV2Fields,
  isValidNonEmptyStringField,
  validateSecurityExceptionFields,
} from "../../checks/exception-record.js"
import type { ExceptionRegistrySchema, ExceptionType } from "../../checks/exception-record.js"
import type { CoderabbitExceptionRecord, NormalizedFinding } from "./evidence-types.js"

/** Every value a stored record's `severity` may hold -- `"unknown"` included, since a record mirrors whatever `normalizeFinding` assigned. */
const SEVERITY_VALUES = new Set<unknown>(["critical", "major", "minor", "unknown"])

/**
 * `"validated-false-positive"` is excluded from a CodeRabbit exception's allowed set -- unlike a
 * deterministic scanner, there is no more-authoritative tool to mechanically re-run against an
 * AI-generated finding to confirm it "doesn't actually apply". A CodeRabbit finding judged
 * incorrect is still only ever dismissed via `"accepted-risk"` / `"tooling-limitation"` / etc.,
 * backed by `method: "independent-human-review"`.
 */
export const CODERABBIT_EXCEPTION_TYPES: readonly ExceptionType[] = EXCEPTION_TYPES.filter(
  (type) => type !== "validated-false-positive",
)

/**
 * The check-namespaced semantic identity of one CodeRabbit finding:
 * `coderabbit:<file>:<severity>:<12-hex-char sha256 of the trimmed summary>`. Injective over a run
 * (two findings with identical file+severity+summary are true duplicates); churns across a
 * re-review whose summary prose changed.
 * @param finding - The finding's (or record's) identity fields.
 * @param finding.file - The finding's file path, verbatim from CodeRabbit.
 * @param finding.severity - The normalized severity tier.
 * @param finding.summary - The finding's descriptive text (hashed into the id).
 * @returns The semantic id.
 */
export function deriveCoderabbitExceptionId(finding: {
  readonly file: string
  readonly severity: string
  readonly summary: string
}): string {
  const hash = createHash("sha256").update(finding.summary.trim()).digest("hex").slice(0, 12)
  return `coderabbit:${finding.file}:${finding.severity}:${hash}`
}

/**
 * A fresh, blank exception record for a finding with no matching record yet -- every authoring field
 * starts empty (valid registry data, only policy-insufficient).
 * @param finding - The unmatched finding.
 * @param id - The canonical id reconciliation computed (equals `finding.id`).
 * @returns The blank stub record.
 */
export function createCoderabbitStub(
  finding: NormalizedFinding,
  id: string,
): CoderabbitExceptionRecord {
  return {
    id,
    version: 2,
    justification: "",
    alternatives: "",
    remediation: "",
    method: "",
    exceptionType: "",
    ...emptyV2Fields(),
    file: finding.file,
    severity: finding.severity,
    summary: finding.summary,
  }
}

/** The per-registry schema for `.repo-contract/exceptions/coderabbit.json`. */
export const CODERABBIT_EXCEPTION_SCHEMA: ExceptionRegistrySchema<CoderabbitExceptionRecord> = {
  namespace: "coderabbit:",
  metadataKeys: [...SECURITY_EXCEPTION_FIELD_KEYS, "file", "severity", "summary"],
  validateRecord(core, raw, index, errors) {
    const at = `exceptions[${String(index)}]`
    const { file, severity, summary } = raw

    const fileValid = isValidNonEmptyStringField(file, `${at}.file`, errors)
    const severityValid = SEVERITY_VALUES.has(severity)
    if (!severityValid) {
      errors.push(
        `${at}.severity must be one of ${[...SEVERITY_VALUES].map((s) => JSON.stringify(s)).join(", ")} (got ${JSON.stringify(severity)}).`,
      )
    }
    const summaryValid = isValidNonEmptyStringField(summary, `${at}.summary`, errors)

    const security = validateSecurityExceptionFields(raw, index, CODERABBIT_EXCEPTION_TYPES, errors)
    if (security?.method === "mechanical-reverification") {
      errors.push(
        `${at}.method must be "independent-human-review" for a CodeRabbit waiver -- there is no tool this check can mechanically re-run to substantiate dismissing an AI-generated finding (repo-contract ADR 0014).`,
      )
      return undefined
    }

    // Stryker disable next-line ConditionalExpression: when `security` is undefined its validator has already pushed an error, so the registry is invalid either way -- the check only narrows the type
    if (!fileValid || !severityValid || !summaryValid || security === undefined) return undefined

    const identity = { file, severity: severity as string, summary }
    const derived = deriveCoderabbitExceptionId(identity)
    if (derived !== core.id) {
      errors.push(
        `${at}.id ${JSON.stringify(core.id)} does not match the id derived from its own file/severity/summary (${JSON.stringify(derived)}).`,
      )
      return undefined
    }

    return {
      id: core.id,
      version: 1,
      justification: core.justification,
      ...security,
      file,
      severity: severity as CoderabbitExceptionRecord["severity"],
      summary,
    }
  },
}
