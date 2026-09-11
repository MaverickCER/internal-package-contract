/**
 * Supply-chain alert scanning via `@socketsecurity/cli` (`socket ci --json`) -- a generic
 * recreation of repo-contract's own self-hosting `security-socket` check
 * (`scripts/security-socket/*` + `checks/security-socket.ts` in that repo), adapted to run
 * against a consuming package (env-cap, data-cap, ...) the same way every other check here does.
 *
 * `run` invokes the real `socket` CLI directly -- `defineRepoContract`'s own engine reports a
 * missing binary as `result.status === "spawn_error"` with `spawnErrorCode: "ENOENT"`, so no
 * wrapper script is needed to detect "not installed" (unlike repo-contract's own version, which
 * predates that engine capability and hand-rolls the same detection via `cross-spawn`).
 * `--no-banner --no-spinner` keep stdout pure JSON (confirmed for the `ci` subcommand
 * specifically -- see repo-contract's own scan script for the caveat about other subcommands,
 * irrelevant here since only `ci` is ever invoked).
 *
 * ## Severity policy
 *
 * Per the same direction repo-contract's own check follows: `critical`/`high` alerts are
 * `forbidden` outright -- no waiver possible, the dependency must be removed or swapped.
 * `middle`/`low` (and any severity value this check doesn't recognize, treated at least as
 * strictly as `middle`) are waivable via a finding-specific record in
 * `.repo-contract/exceptions/socket.json`, using the same reusable exception-policy primitive
 * (`repo-contract/helpers`) every other governed check in this package uses. A `low` alert's
 * waiver drops the `alternatives`/`remediation` prose requirement; every other tier requires all
 * five fields (`justification`, `alternatives`, `remediation`, `method`, `exceptionType`).
 *
 * Example record:
 *
 * ```json
 * {
 *   "exceptions": [
 *     {
 *       "id": "socket:hashery@1.5.1:filesystem",
 *       "version": 1,
 *       "justification": "Transitive via eslint's own file-entry-cache -> flat-cache -> cacheable chain; reads its own cache file only.",
 *       "alternatives": "None -- eslint itself pulls this in; not a direct dependency choice.",
 *       "remediation": "None planned; revisit if eslint drops the dependency.",
 *       "method": "independent-human-review",
 *       "exceptionType": "accepted-risk",
 *       "package": "hashery",
 *       "packageVersion": "1.5.1",
 *       "type": "filesystem",
 *       "severity": "low"
 *     }
 *   ]
 * }
 * ```
 *
 * The registry is reconciled every run (unlike `mutation.ts`'s deliberately non-reconciling
 * model): Socket's own findings for a given `package@version` are stable/deterministic, so a
 * blank stub is scaffolded for a genuinely new alert and a record with no matching alert this run
 * is reported stale -- exactly repo-contract's own approach, via the same
 * `reconcileExceptions`/`writeExceptionRegistry` (`repo-contract/helpers`) primitives.
 */
import type { CheckDefinitionConfig, PolicyResult } from "repo-contract"
import type {
  ExceptionClassification,
  ExceptionPolicy,
  ExceptionPolicyConfig,
  ExceptionRecordCore,
  StandardSchemaV1,
} from "repo-contract/helpers"
import {
  evaluateExceptionRecord,
  loadExceptionRegistry,
  reconcileExceptions,
  validateExceptionPolicyConfig,
  writeExceptionRegistry,
} from "repo-contract/helpers"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { validateExceptionRegistry } from "./exception-record.js"
import type { ExceptionRegistrySchema } from "./exception-record.js"
import { abnormalTermination } from "./shared.js"

const REGISTRY_RELATIVE_PATH = ".repo-contract/exceptions/socket.json"

/** Socket's own recognized severity tiers -- what a *raw alert* may report. Anything else normalizes to `"unknown"` (never a value Socket itself sends). */
const RAW_SEVERITY_VALUES = new Set(["critical", "high", "middle", "low"])
/** Every value a *stored record*'s severity field may hold -- includes `"unknown"`, since a record mirrors whatever `normalizeAlert` assigned. */
const RECORD_SEVERITY_VALUES = new Set(["critical", "high", "middle", "low", "unknown"])

/** One Socket.dev alert, normalized from the CLI's own report shape. */
interface NormalizedSocketAlert {
  readonly id: string
  readonly package: string
  readonly version: string
  readonly type: string
  readonly severity: "critical" | "high" | "middle" | "low" | "unknown"
}

/** The small, closed vocabulary of *why* a Socket alert is deliberately tolerated -- see repo-contract's own `scripts/shared/exception-record.ts` for the full per-value rationale this mirrors. */
const EXCEPTION_TYPES = [
  "validated-false-positive",
  "accepted-risk",
  "compensating-control",
  "tooling-limitation",
  "scheduled-remediation",
  "platform-or-vendor-constraint",
] as const
type ExceptionType = (typeof EXCEPTION_TYPES)[number]

/** How an exception's claim was substantiated -- required on every record. */
const EXCEPTION_METHODS = ["mechanical-reverification", "independent-human-review"] as const
type ExceptionMethod = (typeof EXCEPTION_METHODS)[number]

/** One `.repo-contract/exceptions/socket.json` record: the shared core plus this registry's own identity and justification fields. */
interface SocketExceptionRecord {
  readonly id: string
  readonly version: 1
  readonly justification: string
  readonly alternatives: string
  readonly remediation: string
  readonly method: "" | ExceptionMethod
  readonly exceptionType: "" | ExceptionType
  readonly package: string
  readonly packageVersion: string
  readonly type: string
  readonly severity: NormalizedSocketAlert["severity"]
}

/** `socket:<package>@<version>:<type>` -- injective over a run (Socket does not emit the same package@version:type twice), stable across runs while the dependency and alert type are unchanged. */
function deriveSocketExceptionId(alert: {
  readonly package: string
  readonly packageVersion: string
  readonly type: string
}): string {
  return `socket:${alert.package}@${alert.packageVersion}:${alert.type}`
}

/** A fresh, blank exception record for an alert with no matching record yet -- every authoring field starts empty (valid registry data, only policy-insufficient). */
function createSocketStub(alert: NormalizedSocketAlert, id: string): SocketExceptionRecord {
  return {
    id,
    version: 1,
    justification: "",
    alternatives: "",
    remediation: "",
    method: "",
    exceptionType: "",
    package: alert.package,
    packageVersion: alert.version,
    type: alert.type,
    severity: alert.severity,
  }
}

const SOCKET_EXCEPTION_SCHEMA: ExceptionRegistrySchema<SocketExceptionRecord> = {
  namespace: "socket:",
  metadataKeys: [
    "alternatives",
    "remediation",
    "method",
    "exceptionType",
    "package",
    "packageVersion",
    "type",
    "severity",
  ],
  validateRecord(core: ExceptionRecordCore, raw, index, errors) {
    const at = `exceptions[${String(index)}]`
    const {
      alternatives,
      remediation,
      method,
      exceptionType,
      package: pkg,
      packageVersion,
      type,
      severity,
    } = raw

    const alternativesValid = typeof alternatives === "string"
    if (!alternativesValid) errors.push(`${at}.alternatives must be a string.`)
    const remediationValid = typeof remediation === "string"
    if (!remediationValid) errors.push(`${at}.remediation must be a string.`)
    const methodValid =
      method === "" ||
      (typeof method === "string" && (EXCEPTION_METHODS as readonly string[]).includes(method))
    if (!methodValid) {
      errors.push(
        `${at}.method must be "" or one of ${EXCEPTION_METHODS.map((m) => JSON.stringify(m)).join(", ")} (got ${JSON.stringify(method)}).`,
      )
    }
    const exceptionTypeValid =
      exceptionType === "" ||
      (typeof exceptionType === "string" &&
        (EXCEPTION_TYPES as readonly string[]).includes(exceptionType))
    if (!exceptionTypeValid) {
      errors.push(
        `${at}.exceptionType must be "" or one of ${EXCEPTION_TYPES.map((t) => JSON.stringify(t)).join(", ")} (got ${JSON.stringify(exceptionType)}).`,
      )
    }
    const pkgValid = typeof pkg === "string" && pkg.length > 0
    if (!pkgValid) errors.push(`${at}.package must be a non-empty string.`)
    const versionValid = typeof packageVersion === "string" && packageVersion.length > 0
    if (!versionValid) errors.push(`${at}.packageVersion must be a non-empty string.`)
    const typeValid = typeof type === "string" && type.length > 0
    if (!typeValid) errors.push(`${at}.type must be a non-empty string.`)
    const severityValid = typeof severity === "string" && RECORD_SEVERITY_VALUES.has(severity)
    if (!severityValid) {
      errors.push(
        `${at}.severity must be one of ${[...RECORD_SEVERITY_VALUES].map((s) => JSON.stringify(s)).join(", ")} (got ${JSON.stringify(severity)}).`,
      )
    }

    if (
      !alternativesValid ||
      !remediationValid ||
      !methodValid ||
      !exceptionTypeValid ||
      !pkgValid ||
      !versionValid ||
      !typeValid ||
      !severityValid
    ) {
      return undefined
    }

    if (
      exceptionType === "validated-false-positive" &&
      method !== "" &&
      method !== "mechanical-reverification"
    ) {
      errors.push(
        `${at}: exceptionType "validated-false-positive" requires method "mechanical-reverification"; got method ${JSON.stringify(method)}.`,
      )
      return undefined
    }

    const identity = { package: pkg, packageVersion, type }
    const derived = deriveSocketExceptionId(identity)
    if (derived !== core.id) {
      errors.push(
        `${at}.id ${JSON.stringify(core.id)} does not match the id derived from its own package/packageVersion/type (${JSON.stringify(derived)}).`,
      )
      return undefined
    }

    return {
      id: core.id,
      version: 1,
      justification: core.justification,
      alternatives,
      remediation,
      method: method as SocketExceptionRecord["method"],
      exceptionType: exceptionType as SocketExceptionRecord["exceptionType"],
      ...identity,
      severity: severity as SocketExceptionRecord["severity"],
    }
  },
}

const AUTHORING_REQUIREMENTS_FULL = [
  "justification",
  "alternatives",
  "remediation",
  "method",
  "exceptionType",
]
const AUTHORING_REQUIREMENTS_LIGHT = ["justification", "method", "exceptionType"]

/** Above medium severity is never waivable; middle/low/unknown require a complete, finding-specific exception. */
const SOCKET_POLICY: ExceptionPolicyConfig = {
  socket: {
    rules: {
      critical: { mode: "forbidden" },
      high: { mode: "forbidden" },
      middle: { mode: "exception", requirements: [...AUTHORING_REQUIREMENTS_FULL] },
      low: { mode: "exception", requirements: [...AUTHORING_REQUIREMENTS_LIGHT] },
      unknown: { mode: "exception", requirements: [...AUTHORING_REQUIREMENTS_FULL] },
    },
  },
}
const SOCKET_GLOBAL_DEFAULT_POLICY: ExceptionPolicy = {
  mode: "exception",
  requirements: [...AUTHORING_REQUIREMENTS_FULL],
}
const VALID_SOCKET_REQUIREMENTS = [
  "justification",
  "alternatives",
  "remediation",
  "method",
  "exceptionType",
] as const

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
function safeString(value: unknown): string {
  return typeof value === "string" ? value : ""
}

/** Recognizes Socket's own "not authenticated" JSON envelope: `{ "ok": false, "message": "Auth Error", ... }`. */
function isAuthError(parsed: unknown): boolean {
  return (
    isPlainObject(parsed) &&
    parsed["ok"] === false &&
    (parsed["message"] === "Auth Error" || parsed["message"] === "AuthError")
  )
}

/** A conservative recognizer for a network-reachability failure -- see repo-contract's own scan.ts for why this stays narrow rather than broad. */
function isNetworkUnreachable(stderr: string, parsed: unknown): boolean {
  const NETWORK_ERROR_CODES = /\b(ENOTFOUND|ETIMEDOUT|ECONNREFUSED|ECONNRESET)\b/
  if (NETWORK_ERROR_CODES.test(stderr)) return true
  if (isPlainObject(parsed) && parsed["ok"] === false) {
    const text = `${safeString(parsed["message"])} ${safeString(parsed["cause"])} ${safeString(parsed["data"])}`
    return /network|unreachable|could not connect/i.test(text)
  }
  return false
}

function normalizeAlert(raw: unknown): NormalizedSocketAlert | undefined {
  if (!isPlainObject(raw)) return undefined
  const packageName = raw["package"] ?? raw["name"]
  const { version, type } = raw
  const severityRaw = raw["severity"]
  if (typeof packageName !== "string" || packageName.length === 0) return undefined
  if (typeof version !== "string" || version.length === 0) return undefined
  if (typeof type !== "string" || type.length === 0) return undefined
  const severity =
    typeof severityRaw === "string" && RAW_SEVERITY_VALUES.has(severityRaw.toLowerCase())
      ? (severityRaw.toLowerCase() as "critical" | "high" | "middle" | "low")
      : "unknown"
  return {
    id: deriveSocketExceptionId({ package: packageName, packageVersion: version, type }),
    package: packageName,
    version,
    type,
    severity,
  }
}

/** Widens typed records to the flat shape `writeExceptionRegistry` (`repo-contract/helpers`) accepts -- TypeScript will not infer the implicit index signature through an `interface`. */
function asFlatExceptionRecords(
  records: readonly SocketExceptionRecord[],
): readonly (Record<string, unknown> & { readonly id: string })[] {
  return records as unknown as readonly (Record<string, unknown> & { readonly id: string })[]
}

function socketFieldValue(record: SocketExceptionRecord, requirement: string): string {
  const value = (record as unknown as Record<string, unknown>)[requirement]
  return typeof value === "string" ? value : ""
}

function evaluateAlert(
  alert: NormalizedSocketAlert,
  record: SocketExceptionRecord | undefined,
): {
  readonly verdict: "forbidden" | "insufficient" | "permitted" | "unmatched"
  readonly missing: readonly string[]
} {
  if (record === undefined) return { verdict: "unmatched", missing: [] }
  const classifications: readonly [ExceptionClassification, ...ExceptionClassification[]] = [
    { group: "socket", category: alert.severity },
  ]
  const determinant = evaluateExceptionRecord({
    record,
    classifications,
    config: SOCKET_POLICY,
    globalDefault: SOCKET_GLOBAL_DEFAULT_POLICY,
    fieldValue: socketFieldValue,
  })
  return { verdict: determinant.verdict, missing: determinant.missing }
}

const registrySchema: StandardSchemaV1<unknown, readonly SocketExceptionRecord[]> = {
  "~standard": {
    version: 1,
    vendor: "internal-package-contract",
    validate: (value: unknown) => {
      const result = validateExceptionRegistry(value, SOCKET_EXCEPTION_SCHEMA)
      return result.ok
        ? { value: result.records }
        : { issues: result.errors.map((message) => ({ message })) }
    },
  },
}

/** @returns the `SecuritySocket` check. */
export function securitySocket(): CheckDefinitionConfig {
  return {
    run: ["socket", "ci", "--json", "--no-banner", "--no-spinner"],
    policy: async ({ result }): Promise<PolicyResult> => {
      if (result.status === "spawn_error" && result.spawnErrorCode === "ENOENT") {
        return {
          outcome: "warn",
          rationale:
            "security-socket did not run (cli-not-installed) -- alerts were not evaluated. Install and authenticate @socketsecurity/cli to enable real enforcement.",
        }
      }
      const terminated = abnormalTermination(result, "socket")
      if (terminated) return { outcome: "fail", rationale: terminated }

      const registryPath = path.join(process.cwd(), REGISTRY_RELATIVE_PATH)
      const loaded = await loadExceptionRegistry({ path: registryPath, schema: registrySchema })

      let parsed: unknown
      try {
        parsed = JSON.parse(result.stdout.trim())
      } catch {
        parsed = undefined
      }

      if (isAuthError(parsed)) {
        const note = loaded.ok
          ? loaded.records.length > 0
            ? ` ${String(loaded.records.length)} exception record(s) in ${REGISTRY_RELATIVE_PATH} were validated but not reconciled (the CLI produced no alert list this run).`
            : ""
          : ""
        return {
          outcome: "warn",
          rationale: `security-socket did not run (not-authenticated) -- alerts were not evaluated. Install and authenticate @socketsecurity/cli to enable real enforcement.${note}`,
        }
      }
      if (isNetworkUnreachable(result.stderr, parsed)) {
        return {
          outcome: "warn",
          rationale:
            "security-socket did not run (network-unreachable) -- alerts were not evaluated.",
        }
      }
      if (parsed === undefined) {
        return {
          outcome: "fail",
          rationale: `\`socket ci --json\` produced no parseable JSON output (exit code ${String(result.exitCode)}).`,
        }
      }
      if (!isPlainObject(parsed) || typeof parsed["ok"] !== "boolean") {
        return {
          outcome: "fail",
          rationale: '`socket ci --json` produced JSON with no recognized "ok" boolean field.',
        }
      }
      if (!parsed["ok"]) {
        const message = parsed["message"]
        const detail =
          typeof message === "string" ? message : "socket ci reported an unrecognized failure."
        return { outcome: "fail", rationale: `security-socket scan failed: ${detail}` }
      }

      const data = parsed["data"]
      const rawAlerts = (isPlainObject(data) ? data["alerts"] : undefined) ?? parsed["alerts"] ?? []
      if (!Array.isArray(rawAlerts)) {
        return {
          outcome: "fail",
          rationale: '`socket ci --json` reported `ok: true` with a non-array "alerts" field.',
        }
      }
      const normalized = rawAlerts.map((raw) => normalizeAlert(raw))
      const malformedIndex = normalized.findIndex((alert) => alert === undefined)
      if (malformedIndex !== -1) {
        return {
          outcome: "fail",
          rationale: `\`socket ci --json\` reported an alert entry (index ${String(malformedIndex)}) missing a required field (package/version/type).`,
        }
      }
      const alerts = normalized as NormalizedSocketAlert[]

      if (!loaded.ok) {
        return {
          outcome: "fail",
          rationale: [
            `${REGISTRY_RELATIVE_PATH} failed to load and was left unchanged:`,
            ...loaded.errors.map((e) => `- ${e}`),
          ].join("\n"),
        }
      }

      const reconciled = reconcileExceptions<NormalizedSocketAlert, SocketExceptionRecord>({
        existing: loaded.records,
        findings: alerts,
        deriveId: (alert) => alert.id,
        createStub: createSocketStub,
      })
      if (!reconciled.ok) {
        return {
          outcome: "fail",
          rationale: `${REGISTRY_RELATIVE_PATH} could not be reconciled: ${reconciled.error}`,
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
          return {
            outcome: "fail",
            rationale: `Writing ${REGISTRY_RELATIVE_PATH} failed: ${write.error}`,
          }
        }
      } catch (error) {
        return {
          outcome: "fail",
          rationale: `Could not write ${REGISTRY_RELATIVE_PATH}: ${(error as Error).message}`,
        }
      }

      const configErrors = validateExceptionPolicyConfig(SOCKET_POLICY, VALID_SOCKET_REQUIREMENTS)
      if (configErrors.length > 0) {
        return {
          outcome: "fail",
          rationale: ["SOCKET_POLICY is misconfigured:", ...configErrors.map((e) => `- ${e}`)].join(
            "\n",
          ),
        }
      }

      const activeById = new Map(activeRecords.map((r) => [r.id, r]))
      const staleLines = staleRecords.map(
        (record) =>
          `- Stale exception in ${REGISTRY_RELATIVE_PATH}: ${JSON.stringify(record.id)} -- Socket no longer raises this alert; delete this entry.`,
      )
      const determinants = alerts.map((alert) => ({
        alert,
        ...evaluateAlert(alert, activeById.get(alert.id)),
      }))
      const offenders = determinants.filter((d) => d.verdict !== "permitted")

      if (offenders.length === 0 && staleLines.length === 0) {
        const suffix =
          newStubIds.length > 0
            ? ` (${String(newStubIds.length)} new record(s) scaffolded blank in ${REGISTRY_RELATIVE_PATH})`
            : ""
        return {
          outcome: alerts.length === 0 ? "pass" : "pass",
          rationale: `${String(alerts.length)} Socket alert(s) evaluated: all permitted by a complete exception record.${suffix}`,
        }
      }

      const offenderLines = offenders.map((d) => {
        const detail =
          d.verdict === "forbidden"
            ? "forbidden by policy (above medium severity)"
            : d.verdict === "unmatched"
              ? "no reconciled exception record (registry integrity failure)"
              : `exception incomplete (missing: ${d.missing.join(", ")})`
        return `- ${d.alert.id} [${d.alert.severity}]: ${detail}`
      })

      return {
        outcome: "fail",
        rationale: [
          `${String(offenders.length + staleRecords.length)} Socket alert(s) or stale record(s) need attention:`,
          ...offenderLines,
          ...staleLines,
        ].join("\n"),
      }
    },
  }
}
