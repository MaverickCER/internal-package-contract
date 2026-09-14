/**
 * Runtime dependency vulnerability scanning via `npm audit`, gated through the same reviewable,
 * file-based exception-registry model every other security-family check in this package uses
 * (`SecuritySocket`, and the shared core in `./exception-record.js`) -- never a hardcoded
 * in-source allowlist. `npm audit`'s own raw evidence is read and reported verbatim; an accepted
 * finding is never stripped from it. Acceptance is decided entirely at the policy layer: a
 * finding with no matching, complete exception record fails, regardless of how well-known or
 * long-standing it is.
 *
 * `--omit=dev` scopes the scan to the dependency graph actually shipped to a consumer's own
 * installers; a finding can still surface here for a package that is transitively required by
 * this package's own dev tooling (npm's own arborist/pacote/sigstore chain via `licensee`,
 * Vitest's coverage internals, markdownlint-cli2's TOML parser, adm-zip via `github-actionlint`)
 * when npm's own `--omit` filtering doesn't cleanly separate a hoisted/deduplicated package from
 * every path that reaches it. Every one of those has a real, standing exception record in
 * `.repo-contract/exceptions/security-deps.json` (id, justification, alternatives considered,
 * remediation status, method, exceptionType) -- reviewable and revisable like any other
 * exception, never a name silently dropped from a Set.
 *
 * Every severity requires the full field set (no severity-tiered "forbidden above medium" the
 * way `SecuritySocket` has): a dependency vulnerability, unlike a Socket supply-chain-behavior
 * alert about a package you're generally free to swap, is very often deep in a *required*
 * tooling chain with no real alternative -- the exception system exists precisely to make that
 * judgment call reviewable, not to forbid it outright regardless of severity.
 */
import path from "node:path"
import type { CheckDefinitionConfig, PolicyResult } from "repo-contract"
import type {
  ExceptionClassification,
  ExceptionPolicy,
  ExceptionPolicyConfig,
  ExceptionRecordCore,
} from "repo-contract/helpers"
import {
  EXCEPTION_TYPES,
  SECURITY_EXCEPTION_FIELD_KEYS,
  buildRegistrySchema,
  evaluateFindingVerdict,
  isValidNonEmptyStringField,
  reconcileRegistry,
  summarizeReconciliation,
  validateSecurityExceptionFields,
} from "./exception-record.js"
import type { ExceptionRegistrySchema, ExceptionMethod, ExceptionType } from "./exception-record.js"
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

/** One normalized `npm audit` finding -- one per vulnerable top-level package name, exactly as npm audit's own report already groups them (a single entry can cover several distinct advisories at once). */
interface NormalizedDepFinding {
  readonly id: string
  readonly package: string
  readonly range: string
  readonly severity: Severity
}

/** One `.repo-contract/exceptions/security-deps.json` record: the shared security-family fields plus this registry's own identity fields. */
interface SecurityDepsExceptionRecord {
  readonly id: string
  readonly version: 1
  readonly justification: string
  readonly alternatives: string
  readonly remediation: string
  readonly method: "" | ExceptionMethod
  readonly exceptionType: "" | ExceptionType
  readonly package: string
  readonly range: string
  readonly severity: Severity
}

/** `security-deps:<package>@<range>` -- stable while the same vulnerable range is reported; a version bump or a new/different advisory changes `range` and the id with it, so a stale record is never silently reused for an unrelated finding. */
function deriveSecurityDepsExceptionId(finding: {
  readonly package: string
  readonly range: string
}): string {
  return `security-deps:${finding.package}@${finding.range}`
}

/** A fresh, blank exception record for a finding with no matching record yet. */
function createSecurityDepsStub(
  finding: NormalizedDepFinding,
  id: string,
): SecurityDepsExceptionRecord {
  return {
    id,
    version: 1,
    justification: "",
    alternatives: "",
    remediation: "",
    method: "",
    exceptionType: "",
    package: finding.package,
    range: finding.range,
    severity: finding.severity,
  }
}

const SECURITY_DEPS_EXCEPTION_SCHEMA: ExceptionRegistrySchema<SecurityDepsExceptionRecord> = {
  namespace: "security-deps:",
  metadataKeys: [...SECURITY_EXCEPTION_FIELD_KEYS, "package", "range", "severity"],
  validateRecord(core: ExceptionRecordCore, raw, index, errors) {
    const at = `exceptions[${String(index)}]`
    const security = validateSecurityExceptionFields(raw, index, EXCEPTION_TYPES, errors)

    const { package: pkg, range, severity } = raw
    const pkgValid = isValidNonEmptyStringField(pkg, `${at}.package`, errors)
    const rangeValid = isValidNonEmptyStringField(range, `${at}.range`, errors)
    const severityValid =
      typeof severity === "string" && (SEVERITY_VALUES.has(severity) || severity === "unknown")
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

/** Every severity requires the full field set -- see this module's own doc comment for why there is no severity-tiered "forbidden" the way `SecuritySocket` has. */
const REQUIREMENTS = ["justification", "alternatives", "remediation", "method", "exceptionType"]
const SECURITY_DEPS_POLICY: ExceptionPolicyConfig = {
  "security-deps": { default: { mode: "exception", requirements: [...REQUIREMENTS] } },
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
] as const

function evaluateFinding(
  finding: NormalizedDepFinding,
  record: SecurityDepsExceptionRecord | undefined,
): {
  readonly verdict: "forbidden" | "insufficient" | "permitted" | "unmatched"
  readonly missing: readonly string[]
} {
  const classifications: readonly [ExceptionClassification, ...ExceptionClassification[]] = [
    { group: "security-deps", category: finding.severity },
  ]
  return evaluateFindingVerdict(
    record,
    classifications,
    SECURITY_DEPS_POLICY,
    SECURITY_DEPS_GLOBAL_DEFAULT_POLICY,
  )
}

const registrySchema = buildRegistrySchema(SECURITY_DEPS_EXCEPTION_SCHEMA)

/** Normalizes `npm audit --json`'s own `vulnerabilities` object into one finding per package. */
function normalizeFindings(report: NpmAuditReport): readonly NormalizedDepFinding[] {
  return Object.entries(report.vulnerabilities ?? {}).map(([name, vulnerability]) => {
    const severityRaw = vulnerability.severity
    const severity: Severity =
      typeof severityRaw === "string" && SEVERITY_VALUES.has(severityRaw)
        ? (severityRaw as Severity)
        : "unknown"
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
      const reconciled = await reconcileRegistry(
        registryPath,
        REGISTRY_RELATIVE_PATH,
        registrySchema,
        findings,
        createSecurityDepsStub,
        "SECURITY_DEPS_POLICY",
        SECURITY_DEPS_POLICY,
        VALID_SECURITY_DEPS_REQUIREMENTS,
      )
      if (!reconciled.ok) return reconciled.result

      return summarizeReconciliation(
        findings,
        reconciled.registry,
        REGISTRY_RELATIVE_PATH,
        "npm audit finding(s)",
        evaluateFinding,
        (finding) => `${finding.id} [${finding.severity}]`,
        () => "npm audit no longer reports this vulnerability; delete this entry.",
      )
    },
  }
}
