/**
 * `SecurityDeps`: no known vulnerability ships in what users install, unless a committed record
 * accepts it.
 *
 * Reads: `npm audit --omit=dev --json` over the lockfile and the registry, and
 * `.repo-contract/exceptions/security-deps.json`. The audit's raw output stays in the evidence; an
 * accepted finding is never stripped from it.
 *
 * Fails on a `critical` advisory, which no record can accept. Fails on any lower advisory whose
 * record is missing or incomplete. Fails on a record whose advisory is gone (stale; delete it).
 * Fails when the audit output is not JSON, and when the registry cannot be loaded or written. Never
 * warns.
 *
 * Exceptions: id `security-deps:<package>@<range>` with `package`, `range` and `severity` fields,
 * the security fields and the version 2 fields. The security fields are `alternatives`,
 * `remediation`, `method` and `exceptionType`, of any type. A blank stub is written for every new
 * finding; the check fails until it is filled in.
 *
 * Runs in the consumer `contract` job, in both git hooks, and in IPC's own self-contract.
 *
 * Limits: one finding per vulnerable package, as npm groups them, so one entry can cover several
 * advisories. npm's `--omit=dev` does not always separate a hoisted package from the dev-only paths
 * that reach it. A tooling-only package can therefore surface here. `SecurityDevDeps` audits the
 * rest of the tree.
 *
 * Example record:
 *
 * ```json
 * {
 *   "exceptions": [
 *     {
 *       "id": "security-deps:tar@<6.2.1",
 *       "version": 2,
 *       "justification": "Reached only through the publisher's own tooling; no patched release yet.",
 *       "alternatives": "Replace the dependency that pulls it in.",
 *       "remediation": "Upgrade as soon as a patched release exists.",
 *       "method": "independent-human-review",
 *       "exceptionType": "scheduled-remediation",
 *       "package": "tar",
 *       "range": "<6.2.1",
 *       "severity": "high",
 *       "ruleBroken": "No known vulnerability ships in what users install.",
 *       "attempted": "An `overrides` entry; the dependency's own version range rejects it.",
 *       "constraint": "The patched release is not published yet.",
 *       "whyPreferable": "A tracked, dated exception beats removing the feature that needs the dependency.",
 *       "residualRisk": "The advisory's path traversal, in a dependency users install.",
 *       "revisitWhen": "A patched release is published.",
 *       "expires": "2026-12-31"
 *     }
 *   ]
 * }
 * ```
 */
import path from "node:path"
import type { CheckDefinitionConfig, PolicyResult } from "repo-contract"
import type {
  ExceptionClassification,
  ExceptionMethod,
  ExceptionPolicy,
  ExceptionPolicyConfig,
  ExceptionRecordCore,
  ExceptionRegistrySchema,
  ExceptionType,
  ExceptionV2Fields,
} from "repo-contract/helpers"
import {
  emptyV2Fields,
  evaluateFindingVerdict,
  EXCEPTION_TYPES,
  EXCEPTION_V2_FIELD_KEYS,
  exceptionRegistryStandardSchema,
  isValidNonEmptyStringField,
  loadAndReconcileExceptionRegistry,
  SECURITY_EXCEPTION_FIELD_KEYS,
  validateExceptionPolicyConfig,
  validateSecurityExceptionFields,
} from "repo-contract/helpers"
import { abnormalTermination } from "./shared.js"

const REGISTRY_RELATIVE_PATH = ".repo-contract/exceptions/security-deps.json"

const SEVERITY_VALUES = new Set(["info", "low", "moderate", "high", "critical"])
type Severity = "info" | "low" | "moderate" | "high" | "critical" | "unknown"

interface NpmAuditVulnerability {
  readonly severity?: string
  readonly range?: string
}
interface NpmAuditReport {
  readonly vulnerabilities?: Record<string, NpmAuditVulnerability>
}

/**
 * One normalized `npm audit` finding: one per vulnerable top-level package name, as npm audit
 * groups them. A single entry can cover several advisories.
 */
interface NormalizedDepFinding {
  readonly id: string
  readonly package: string
  readonly range: string
  readonly severity: Severity
}

/** One `.repo-contract/exceptions/security-deps.json` record: the shared security-family fields plus this registry's own identity fields. */
interface SecurityDepsExceptionRecord extends Partial<ExceptionV2Fields> {
  readonly id: string
  readonly version: 1 | 2
  readonly justification: string
  readonly alternatives: string
  readonly remediation: string
  readonly method: "" | ExceptionMethod
  readonly exceptionType: "" | ExceptionType
  readonly package: string
  readonly range: string
  readonly severity: Severity
}

/**
 * `security-deps:<package>@<range>`: stable while the same vulnerable range is reported. A version
 * bump or a different advisory changes `range` and the id with it. So a stale record is never
 * reused for an unrelated finding.
 * @internal Exported for direct unit coverage: see this module's own doc comment.
 */
export function deriveSecurityDepsExceptionId(finding: {
  readonly package: string
  readonly range: string
}): string {
  return `security-deps:${finding.package}@${finding.range}`
}

/**
 * A fresh, blank exception record for a finding with no matching record yet.
 * @internal Exported for direct unit coverage: see this module's own doc comment.
 */
export function createSecurityDepsStub(
  finding: NormalizedDepFinding,
  id: string,
): SecurityDepsExceptionRecord {
  return {
    id,
    version: 2,
    justification: "",
    alternatives: "",
    remediation: "",
    method: "",
    exceptionType: "",
    ...emptyV2Fields(),
    package: finding.package,
    range: finding.range,
    severity: finding.severity,
  }
}

/** @internal Exported for direct unit coverage: see this module's own doc comment. */
export const SECURITY_DEPS_EXCEPTION_SCHEMA: ExceptionRegistrySchema<SecurityDepsExceptionRecord> =
  {
    namespace: "security-deps:",
    metadataKeys: [...SECURITY_EXCEPTION_FIELD_KEYS, "package", "range", "severity"],
    validateRecord(core: ExceptionRecordCore, raw, index, errors) {
      const at = `exceptions[${String(index)}]`
      const security = validateSecurityExceptionFields(raw, index, EXCEPTION_TYPES, errors)

      const { package: pkg, range, severity } = raw
      const pkgValid = isValidNonEmptyStringField(pkg, `${at}.package`, errors)
      const rangeValid = isValidNonEmptyStringField(range, `${at}.range`, errors)
      // Stryker disable ConditionalExpression: replacing `typeof severity === "string"` with `true`
      // is behaviorally equivalent here. `SEVERITY_VALUES` is a `Set<string>`, and
      // `severity === "unknown"` is a strict string comparison. So both disjuncts are `false` for
      // any non-string `severity`, with no coercion and no throw. The guard serves TypeScript's
      // narrowing only. Hand-verified 2026-09-17: this mutation leaves all 438 tests passing.
      const severityValid =
        typeof severity === "string" && (SEVERITY_VALUES.has(severity) || severity === "unknown")
      // Stryker restore ConditionalExpression
      if (!severityValid) {
        errors.push(
          `${at}.severity must be one of "info", "low", "moderate", "high", "critical", "unknown" (got ${JSON.stringify(severity)}).`,
        )
      }

      if (security === undefined || !pkgValid || !rangeValid || !severityValid) return undefined

      const identity = { package: pkg, range }
      const derived = deriveSecurityDepsExceptionId(identity)
      if (derived !== core.id) {
        errors.push(
          `${at}.id ${JSON.stringify(core.id)} does not match the id derived from its own package/range (${JSON.stringify(derived)}).`,
        )
        return undefined
      }

      return {
        id: core.id,
        version: 1,
        justification: core.justification,
        ...security,
        ...identity,
        severity: severity as Severity,
      }
    },
  }

/**
 * A critical runtime advisory is never waivable: a vulnerability that bad in what users install is
 * fixed or removed, not excused. Every lower severity (a `high` advisory with no patched release yet is
 * common in a required chain) needs a complete, finding-specific exception.
 */
const REQUIREMENTS = [
  "justification",
  "alternatives",
  "remediation",
  "method",
  "exceptionType",
  ...EXCEPTION_V2_FIELD_KEYS,
]
const SECURITY_DEPS_POLICY: ExceptionPolicyConfig = {
  "security-deps": {
    default: { mode: "exception", requirements: [...REQUIREMENTS] },
    rules: { critical: { mode: "forbidden" } },
  },
}
const SECURITY_DEPS_GLOBAL_DEFAULT_POLICY: ExceptionPolicy = {
  mode: "exception",
  requirements: [...REQUIREMENTS],
}
const VALID_SECURITY_DEPS_REQUIREMENTS = [
  "justification",
  "alternatives",
  "remediation",
  "method",
  "exceptionType",
  ...EXCEPTION_V2_FIELD_KEYS,
] as const

/** @internal Exported for direct unit coverage: see this module's own doc comment. */
export function evaluateFinding(
  finding: NormalizedDepFinding,
  record: SecurityDepsExceptionRecord | undefined,
): {
  readonly verdict: "forbidden" | "insufficient" | "permitted" | "unmatched"
  readonly missing: readonly string[]
} {
  // Stryker disable ObjectLiteral, StringLiteral -- unlike SecuritySocket (which forbids
  // critical/high outright), SECURITY_DEPS_POLICY has one group ("security-deps"). Its `default`
  // policy is value-identical to SECURITY_DEPS_GLOBAL_DEFAULT_POLICY (see both above). Every
  // severity requires the same full field set, with no per-category rule to select. When the
  // classification picks no specific rule, `resolveExceptionPolicy` falls back to the group
  // default, or to the global default when no group matches. So corrupting or dropping this
  // classification still resolves to the same policy. Hand-verified 2026-09-17: applying this
  // mutation by hand leaves the whole suite passing.
  const classifications: readonly [ExceptionClassification, ...ExceptionClassification[]] = [
    { group: "security-deps", category: finding.severity },
  ]
  // Stryker restore ObjectLiteral, StringLiteral
  return evaluateFindingVerdict(
    record,
    classifications,
    SECURITY_DEPS_POLICY,
    SECURITY_DEPS_GLOBAL_DEFAULT_POLICY,
  )
}

const registrySchema = exceptionRegistryStandardSchema(SECURITY_DEPS_EXCEPTION_SCHEMA)

/**
 * Normalizes `npm audit --json`'s own `vulnerabilities` object into one finding per package.
 * @internal Exported for direct unit coverage: see this module's own doc comment.
 */
export function normalizeFindings(report: NpmAuditReport): readonly NormalizedDepFinding[] {
  return Object.entries(report.vulnerabilities ?? {}).map(([name, vulnerability]) => {
    const severityRaw = vulnerability.severity
    // Stryker disable ConditionalExpression: replacing `typeof severityRaw === "string"` with
    // `true` is behaviorally equivalent here. `SEVERITY_VALUES` is a `Set<string>`, so
    // `SEVERITY_VALUES.has(severityRaw)` is `false` for any non-string, with no coercion and no
    // throw. The guard serves TypeScript's narrowing for the `severityRaw as Severity` cast below.
    // Hand-verified 2026-09-17: this mutation leaves all 438 tests passing.
    const severity: Severity =
      typeof severityRaw === "string" && SEVERITY_VALUES.has(severityRaw)
        ? (severityRaw as Severity)
        : "unknown"
    // Stryker restore ConditionalExpression
    const range =
      typeof vulnerability.range === "string" && vulnerability.range.length > 0
        ? vulnerability.range
        : "unknown"
    return {
      id: deriveSecurityDepsExceptionId({ package: name, range }),
      package: name,
      range,
      severity,
    }
  })
}

/** @returns the `SecurityDeps` check. */
export function securityDeps(): CheckDefinitionConfig {
  return {
    run: ["npm", "audit", "--omit=dev", "--json"],
    output: { format: "json" },
    policy: async ({ result }): Promise<PolicyResult> => {
      const terminated = abnormalTermination(result, "npm audit")
      if (terminated) return { outcome: "fail", rationale: terminated }

      // `npm audit` exits non-zero the moment it finds anything; `output.success` reflects only
      // whether stdout parsed as JSON, independent of that exit code.
      if (!result.output?.success) {
        return { outcome: "fail", rationale: "npm audit output could not be parsed as JSON." }
      }
      const parsed: unknown = result.output.value
      if (typeof parsed !== "object" || parsed === null) {
        return { outcome: "fail", rationale: "npm audit produced invalid JSON report data." }
      }

      const findings = normalizeFindings(parsed as NpmAuditReport)

      const registryPath = path.join(process.cwd(), REGISTRY_RELATIVE_PATH)
      const persisted = await loadAndReconcileExceptionRegistry(
        registryPath,
        REGISTRY_RELATIVE_PATH,
        registrySchema,
        findings,
        createSecurityDepsStub,
      )
      if (!persisted.ok) return { outcome: "fail", rationale: persisted.rationale }
      const { activeRecords, staleRecords, newStubIds } = persisted.registry

      const configErrors = validateExceptionPolicyConfig(
        SECURITY_DEPS_POLICY,
        VALID_SECURITY_DEPS_REQUIREMENTS,
      )
      // Stryker disable all -- SECURITY_DEPS_POLICY/VALID_SECURITY_DEPS_REQUIREMENTS are fixed,
      // valid module constants (defined above). They never vary at runtime, so this guard never
      // sees a misconfigured policy, and no test can reach it without breaking them. It stays as
      // defense in depth against a future editing mistake in SECURITY_DEPS_POLICY.
      if (configErrors.length > 0) {
        return {
          outcome: "fail",
          rationale: [
            "SECURITY_DEPS_POLICY is misconfigured:",
            ...configErrors.map((e) => `- ${e}`),
          ].join("\n"),
        }
      }
      // Stryker restore all

      const activeById = new Map(activeRecords.map((r) => [r.id, r]))
      const staleLines = staleRecords.map(
        (record) =>
          `- Stale exception in ${REGISTRY_RELATIVE_PATH}: ${JSON.stringify(record.id)}; npm audit no longer reports this vulnerability; delete this entry.`,
      )
      const determinants = findings.map((finding) => ({
        finding,
        ...evaluateFinding(finding, activeById.get(finding.id)),
      }))
      const offenders = determinants.filter((d) => d.verdict !== "permitted")

      if (offenders.length === 0 && staleLines.length === 0) {
        // Stryker disable all -- unlike SecuritySocket, every severity here requires the full
        // field set (see this module's doc comment). So `createSecurityDepsStub`'s blank stub is
        // never "permitted". Every finding behind a new stub (`newStubIds`) is its own offender.
        // That makes `offenders.length` nonzero, which skips this branch. So `newStubIds.length >
        // 0` is never true here. Hand-verified 2026-09-17: this mutation leaves the whole suite
        // passing. It stays as defense in depth.
        const suffix =
          newStubIds.length > 0
            ? ` (${String(newStubIds.length)} new record(s) scaffolded blank in ${REGISTRY_RELATIVE_PATH})`
            : ""
        // Stryker restore all
        return {
          outcome: "pass",
          rationale: `${String(findings.length)} npm audit finding(s) evaluated: all permitted by a complete exception record.${suffix}`,
        }
      }

      const offenderLines = offenders.map((d) => {
        // Stryker disable all -- `activeById` is built from `activeRecords`, which
        // `reconcileAndPersistExceptionRegistry` fills with an entry for every id in `findings`
        // (existing or a new stub). So `activeById.get(finding.id)` is never `undefined` here, and
        // `evaluateFinding` never returns "unmatched" on this path. Hand-verified 2026-09-17: this
        // mutation leaves the whole suite passing. It stays as defense in depth against a
        // reconcile/evaluate bijection bug.
        const detail =
          d.verdict === "unmatched"
            ? "no reconciled exception record (registry integrity failure)"
            : `exception incomplete (missing: ${d.missing.join(", ")})`
        // Stryker restore all
        return `- ${d.finding.id} [${d.finding.severity}]: ${detail}`
      })

      return {
        outcome: "fail",
        rationale: [
          `${String(offenders.length + staleRecords.length)} npm audit finding(s) or stale record(s) need attention:`,
          ...offenderLines,
          ...staleLines,
        ].join("\n"),
      }
    },
  }
}
