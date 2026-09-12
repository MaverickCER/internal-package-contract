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
import type { CheckDefinitionConfig, CheckEvidence, PolicyResult } from "repo-contract"
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

/** `value` is a string -- pushes a `"<at> must be a string."` message onto `errors` otherwise. */
function isValidStringField(value: unknown, at: string, errors: string[]): value is string {
  const valid = typeof value === "string"
  if (!valid) errors.push(`${at} must be a string.`)
  return valid
}

/** `value` is a non-empty string -- pushes a `"<at> must be a non-empty string."` message onto `errors` otherwise. */
function isValidNonEmptyStringField(value: unknown, at: string, errors: string[]): value is string {
  const valid = typeof value === "string" && value.length > 0
  if (!valid) errors.push(`${at} must be a non-empty string.`)
  return valid
}

/** `value` is `""` or one of `allowed` -- pushes a descriptive message onto `errors` otherwise. Shared shape behind `method`'s and `exceptionType`'s own validation. */
function isValidOptionalEnumField(
  value: unknown,
  at: string,
  allowed: readonly string[],
  errors: string[],
): boolean {
  const valid = value === "" || (typeof value === "string" && allowed.includes(value))
  if (!valid) {
    errors.push(
      `${at} must be "" or one of ${allowed.map((v) => JSON.stringify(v)).join(", ")} (got ${JSON.stringify(value)}).`,
    )
  }
  return valid
}

/** Every `SocketExceptionRecord` field beyond the shared `id`/`version`/`justification` core, already confirmed individually valid -- see {@link validateRecordFields}. */
interface ValidatedSocketFields {
  readonly alternatives: string
  readonly remediation: string
  readonly method: SocketExceptionRecord["method"]
  readonly exceptionType: SocketExceptionRecord["exceptionType"]
  readonly package: string
  readonly packageVersion: string
  readonly type: string
  readonly severity: SocketExceptionRecord["severity"]
}

/** Validates every one of `raw`'s registry-specific fields independently (so one bad field never short-circuits reporting the rest), pushing one message per problem onto `errors`. */
function validateRecordFields(
  raw: Readonly<Record<string, unknown>>,
  at: string,
  errors: string[],
): ValidatedSocketFields | undefined {
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

  const alternativesValid = isValidStringField(alternatives, `${at}.alternatives`, errors)
  const remediationValid = isValidStringField(remediation, `${at}.remediation`, errors)
  const methodValid = isValidOptionalEnumField(method, `${at}.method`, EXCEPTION_METHODS, errors)
  const exceptionTypeValid = isValidOptionalEnumField(
    exceptionType,
    `${at}.exceptionType`,
    EXCEPTION_TYPES,
    errors,
  )
  const pkgValid = isValidNonEmptyStringField(pkg, `${at}.package`, errors)
  const versionValid = isValidNonEmptyStringField(packageVersion, `${at}.packageVersion`, errors)
  const typeValid = isValidNonEmptyStringField(type, `${at}.type`, errors)
  const severityValid = isValidOptionalEnumField(
    severity,
    `${at}.severity`,
    [...RECORD_SEVERITY_VALUES],
    errors,
  )

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

  return {
    alternatives,
    remediation,
    method: method as SocketExceptionRecord["method"],
    exceptionType: exceptionType as SocketExceptionRecord["exceptionType"],
    package: pkg,
    packageVersion,
    type,
    severity: severity as SocketExceptionRecord["severity"],
  }
}

/** A `"validated-false-positive"` claim rests on a re-run, never opinion -- `method` must be `mechanical-reverification` once it's filled in at all. */
function violatesFalsePositiveMethodRule(fields: ValidatedSocketFields): boolean {
  return (
    fields.exceptionType === "validated-false-positive" &&
    fields.method !== "" &&
    fields.method !== "mechanical-reverification"
  )
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
    const fields = validateRecordFields(raw, at, errors)
    if (fields === undefined) return undefined

    if (violatesFalsePositiveMethodRule(fields)) {
      errors.push(
        `${at}: exceptionType "validated-false-positive" requires method "mechanical-reverification"; got method ${JSON.stringify(fields.method)}.`,
      )
      return undefined
    }

    const identity = {
      package: fields.package,
      packageVersion: fields.packageVersion,
      type: fields.type,
    }
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
      alternatives: fields.alternatives,
      remediation: fields.remediation,
      method: fields.method,
      exceptionType: fields.exceptionType,
      ...identity,
      severity: fields.severity,
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
/** The outcome of running and interpreting `socket ci --json` itself, before any registry work. */
type SocketRunOutcome =
  | { readonly kind: "warn" | "fail"; readonly rationale: string }
  | { readonly kind: "ok"; readonly alerts: readonly NormalizedSocketAlert[] }

/**
 * Runs and interprets the socket CLI's own raw evidence -- every recognized non-alert state
 * (not installed, not authenticated, unreachable, malformed output) short-circuits to `warn`/
 * `fail` here; only a genuine, well-formed alert list reaches the caller's registry work.
 * @param existingRecordCount - the exception registry's current record count, for the
 * not-authenticated rationale's "N records validated but not reconciled" note (`0` if the
 * registry itself failed to load -- matches how a load failure is reported separately, never
 * folded into this note).
 */
function interpretSocketRun(result: CheckEvidence, existingRecordCount: number): SocketRunOutcome {
  if (result.status === "spawn_error" && result.spawnErrorCode === "ENOENT") {
    return {
      kind: "warn",
      rationale:
        "security-socket did not run (cli-not-installed) -- alerts were not evaluated. Install and authenticate @socketsecurity/cli to enable real enforcement.",
    }
  }
  const terminated = abnormalTermination(result, "socket")
  if (terminated) return { kind: "fail", rationale: terminated }

  let parsed: unknown
  try {
    parsed = JSON.parse(result.stdout.trim())
  } catch {
    parsed = undefined
  }

  if (isAuthError(parsed)) {
    const note =
      existingRecordCount > 0
        ? ` ${String(existingRecordCount)} exception record(s) in ${REGISTRY_RELATIVE_PATH} were validated but not reconciled (the CLI produced no alert list this run).`
        : ""
    return {
      kind: "warn",
      rationale: `security-socket did not run (not-authenticated) -- alerts were not evaluated. Install and authenticate @socketsecurity/cli to enable real enforcement.${note}`,
    }
  }
  if (isNetworkUnreachable(result.stderr, parsed)) {
    return {
      kind: "warn",
      rationale: "security-socket did not run (network-unreachable) -- alerts were not evaluated.",
    }
  }
  if (parsed === undefined) {
    return {
      kind: "fail",
      rationale: `\`socket ci --json\` produced no parseable JSON output (exit code ${String(result.exitCode)}).`,
    }
  }
  if (!isPlainObject(parsed) || typeof parsed["ok"] !== "boolean") {
    return {
      kind: "fail",
      rationale: '`socket ci --json` produced JSON with no recognized "ok" boolean field.',
    }
  }
  if (!parsed["ok"]) {
    const message = parsed["message"]
    const detail =
      typeof message === "string" ? message : "socket ci reported an unrecognized failure."
    return { kind: "fail", rationale: `security-socket scan failed: ${detail}` }
  }

  const data = parsed["data"]
  const rawAlerts = (isPlainObject(data) ? data["alerts"] : undefined) ?? parsed["alerts"] ?? []
  if (!Array.isArray(rawAlerts)) {
    return {
      kind: "fail",
      rationale: '`socket ci --json` reported `ok: true` with a non-array "alerts" field.',
    }
  }
  const normalized = rawAlerts.map((raw) => normalizeAlert(raw))
  const malformedIndex = normalized.findIndex((alert) => alert === undefined)
  if (malformedIndex !== -1) {
    return {
      kind: "fail",
      rationale: `\`socket ci --json\` reported an alert entry (index ${String(malformedIndex)}) missing a required field (package/version/type).`,
    }
  }
  return { kind: "ok", alerts: normalized as NormalizedSocketAlert[] }
}

/** The registry state a batch of alerts reconciled against, once persisted back to disk. */
interface PersistedRegistry {
  readonly activeRecords: readonly SocketExceptionRecord[]
  readonly staleRecords: readonly SocketExceptionRecord[]
  readonly newStubIds: readonly string[]
}

/** Reconciles `alerts` against `existing` records and writes the result back to `registryPath` -- the one place this check ever mutates the consumer's own tree. */
async function reconcileAndPersistRegistry(
  registryPath: string,
  existing: readonly SocketExceptionRecord[],
  alerts: readonly NormalizedSocketAlert[],
): Promise<
  | { readonly ok: true; readonly registry: PersistedRegistry }
  | { readonly ok: false; readonly rationale: string }
> {
  const reconciled = reconcileExceptions<NormalizedSocketAlert, SocketExceptionRecord>({
    existing,
    findings: alerts,
    deriveId: (alert) => alert.id,
    createStub: createSocketStub,
  })
  if (!reconciled.ok) {
    return {
      ok: false,
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
      return { ok: false, rationale: `Writing ${REGISTRY_RELATIVE_PATH} failed: ${write.error}` }
    }
  } catch (error) {
    return {
      ok: false,
      rationale: `Could not write ${REGISTRY_RELATIVE_PATH}: ${(error as Error).message}`,
    }
  }

  return { ok: true, registry: { activeRecords, staleRecords, newStubIds } }
}

/** The final pass/fail composition, once every alert has a reconciled (possibly freshly-scaffolded) record to evaluate against. */
function evaluateFinalVerdict(
  alerts: readonly NormalizedSocketAlert[],
  registry: PersistedRegistry,
): PolicyResult {
  const configErrors = validateExceptionPolicyConfig(SOCKET_POLICY, VALID_SOCKET_REQUIREMENTS)
  if (configErrors.length > 0) {
    return {
      outcome: "fail",
      rationale: ["SOCKET_POLICY is misconfigured:", ...configErrors.map((e) => `- ${e}`)].join(
        "\n",
      ),
    }
  }

  const activeById = new Map(registry.activeRecords.map((r) => [r.id, r]))
  const staleLines = registry.staleRecords.map(
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
      registry.newStubIds.length > 0
        ? ` (${String(registry.newStubIds.length)} new record(s) scaffolded blank in ${REGISTRY_RELATIVE_PATH})`
        : ""
    return {
      outcome: "pass",
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
      `${String(offenders.length + registry.staleRecords.length)} Socket alert(s) or stale record(s) need attention:`,
      ...offenderLines,
      ...staleLines,
    ].join("\n"),
  }
}

export function securitySocket(): CheckDefinitionConfig {
  return {
    run: ["socket", "ci", "--json", "--no-banner", "--no-spinner"],
    policy: async ({ result }): Promise<PolicyResult> => {
      const registryPath = path.join(process.cwd(), REGISTRY_RELATIVE_PATH)
      const loaded = await loadExceptionRegistry({ path: registryPath, schema: registrySchema })

      const run = interpretSocketRun(result, loaded.ok ? loaded.records.length : 0)
      if (run.kind !== "ok") return { outcome: run.kind, rationale: run.rationale }

      if (!loaded.ok) {
        return {
          outcome: "fail",
          rationale: [
            `${REGISTRY_RELATIVE_PATH} failed to load and was left unchanged:`,
            ...loaded.errors.map((e) => `- ${e}`),
          ].join("\n"),
        }
      }

      const persisted = await reconcileAndPersistRegistry(registryPath, loaded.records, run.alerts)
      if (!persisted.ok) return { outcome: "fail", rationale: persisted.rationale }

      return evaluateFinalVerdict(run.alerts, persisted.registry)
    },
  }
}
