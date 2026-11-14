/**
 * `SecuritySocket`: every alert on the package's own Socket.dev page is fixed or accepted by a
 * committed record.
 *
 * Reads: package.json, and the npm registry, to learn whether the current version is published.
 * Then `socket package score` for that version, or the latest published one when Socket has no
 * result yet, through `scripts/socket-package-score.mjs`. A fresh cached score for the same version
 * is reused. Then `.repo-contract/exceptions/socket.json`. The score covers the package and its
 * whole transitive closure, peers included. `socket ci` is not used: it reports only the org
 * policy's error level.
 *
 * Fails on a `critical` or `high` alert, which no record can accept. Fails on any other alert whose
 * record is missing or incomplete. Fails on a record whose alert is gone (stale; delete it). Fails
 * when the registry cannot be loaded or written. Fails when the scan could not run for a reason
 * other than a missing key. Those reasons are: the CLI is not installed, the token was refused, the
 * network is unreachable, Socket rate-limited the token. Passes for a private package, and for a
 * package that is not published yet. Never warns on a finding.
 *
 * Exceptions: id `socket:<package>@<version>:<alert type>`, with `package`, `packageVersion`,
 * `type` and `severity` fields, the security fields and the version 2 fields. The version is `self`
 * for the scored package itself, so a release does not orphan the record. `exceptionType` must be
 * one of `validated-false-positive`, `tooling-limitation`, `accepted-risk` or
 * `required-for-package-to-exist`. A blank stub is written for every new alert. One degradation,
 * `SecuritySocket:no-key`: no API token here or in CI. It warns locally, with the steps to get a
 * token (`checks/socket-guidance.ts`). Under `--strict`, the CI default, it fails unless
 * `.repo-contract/exceptions/environment.json` holds a complete record. The record id is
 * `environment:SecuritySocket:no-key`; `init` writes one with an expiry date.
 *
 * Runs in the consumer `contract` job, in both git hooks, and in IPC's own self-contract.
 *
 * Example record:
 *
 * ```json
 * {
 *   "exceptions": [
 *     {
 *       "id": "socket:data-cap@self:unpopularPackage",
 *       "version": 2,
 *       "justification": "A new package with few downloads yet; popularity is not something code can change.",
 *       "alternatives": "None; publishing is the way to gain adoption.",
 *       "remediation": "Resolves itself as the package is adopted.",
 *       "method": "independent-human-review",
 *       "exceptionType": "required-for-package-to-exist",
 *       "package": "data-cap",
 *       "packageVersion": "self",
 *       "type": "unpopularPackage",
 *       "severity": "middle",
 *       "ruleBroken": "Every Socket alert on the package is fixed or accepted.",
 *       "attempted": "Nothing; the alert measures downloads.",
 *       "constraint": "A package is new before it is popular.",
 *       "whyPreferable": "Recording the alert keeps the page honest while adoption grows.",
 *       "residualRisk": "None to users; the alert is informational.",
 *       "revisitWhen": "The alert disappears from the package page.",
 *       "expires": ""
 *     }
 *   ]
 * }
 * ```
 */
import path from "node:path"
import type { CheckDefinitionConfig, CheckEvidence, PolicyResult } from "repo-contract"
import type {
  ExceptionClassification,
  ExceptionPolicy,
  ExceptionPolicyConfig,
  ExceptionRecordCore,
  StandardSchemaV1,
} from "repo-contract/helpers"
import { validateExceptionPolicyConfig } from "repo-contract/helpers"
import {
  SOCKET_EXCEPTION_TYPES,
  EXCEPTION_V2_FIELD_KEYS,
  SECURITY_EXCEPTION_FIELD_KEYS,
  emptyV2Fields,
  evaluateFindingVerdict,
  isValidNonEmptyStringField,
  loadAndReconcileExceptionRegistry,
  validateExceptionRegistry,
  validateSecurityExceptionFields,
} from "./exception-record.js"
import type {
  ExceptionV2Fields,
  ExceptionRegistrySchema,
  ExceptionMethod,
  ExceptionType,
  PersistedExceptionRegistry,
} from "./exception-record.js"
import { degraded } from "./environment-exceptions.js"
import { abnormalTermination, packageRoot } from "./shared.js"
import { socketGuidance } from "./socket-guidance.js"
import type { SocketProblem } from "./socket-guidance.js"

const SCRIPT_PATH = path.join(packageRoot, "scripts", "socket-package-score.mjs")
const REGISTRY_RELATIVE_PATH = ".repo-contract/exceptions/socket.json"

/** Socket's own recognized severity tiers: what a *raw alert* may report. Anything else normalizes to `"unknown"` (never a value Socket itself sends). */
const RAW_SEVERITY_VALUES = new Set(["critical", "high", "middle", "low"])
/** Every value a *stored record*'s severity field may hold: includes `"unknown"`, since a record mirrors whatever `normalizeAlert` assigned. */
const RECORD_SEVERITY_VALUES = new Set(["critical", "high", "middle", "low", "unknown"])

/** One Socket.dev alert, normalized from the CLI's own report shape. */
interface NormalizedSocketAlert {
  readonly id: string
  readonly package: string
  readonly version: string
  readonly type: string
  readonly severity: "critical" | "high" | "middle" | "low" | "unknown"
  /** Socket's own alert category (`supplyChainRisk`, `quality`, `license`, ...). */
  readonly category: string
}

/** One `.repo-contract/exceptions/socket.json` record: the shared security-family fields (`./exception-record.js`) plus this registry's own identity fields. */
interface SocketExceptionRecord extends Partial<ExceptionV2Fields> {
  readonly id: string
  readonly version: 1 | 2
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

/**
 * `socket:<package>@<version>:<type>`: injective over a run (Socket does not emit the same package@version:type twice), stable across runs while the dependency and alert type are unchanged.
 * @internal Exported for direct unit coverage: see this module's own doc comment.
 */
export function deriveSocketExceptionId(alert: {
  readonly package: string
  readonly packageVersion: string
  readonly type: string
}): string {
  return `socket:${alert.package}@${alert.packageVersion}:${alert.type}`
}

/**
 * A fresh, blank exception record for an alert with no matching record yet: every authoring field starts empty (valid registry data, only policy-insufficient).
 * @internal Exported for direct unit coverage: see this module's own doc comment.
 */
export function createSocketStub(alert: NormalizedSocketAlert, id: string): SocketExceptionRecord {
  return {
    id,
    version: 2,
    justification: "",
    alternatives: "",
    remediation: "",
    method: "",
    exceptionType: "",
    ...emptyV2Fields(),
    package: alert.package,
    packageVersion: alert.version,
    type: alert.type,
    severity: alert.severity,
  }
}

/**
 * `value` is `""` or one of `allowed`: pushes a descriptive message onto `errors` otherwise.
 * @internal Exported for direct unit coverage: see this module's own doc comment.
 */
export function isValidOptionalEnumField(
  value: unknown,
  at: string,
  allowed: readonly string[],
  errors: string[],
): boolean {
  // Stryker disable next-line ConditionalExpression: replacing `typeof value === "string"` with
  // `true` is behaviorally equivalent here: `allowed` is typed `readonly string[]`, so
  // `allowed.includes(value)` is already `false` for any non-string `value` via plain strict
  // equality (no coercion), with or without the type guard. The guard exists purely to satisfy
  // TypeScript's narrowing for `.includes(value)`, not to change runtime behavior. Hand-verified
  // 2026-09-17: applying this exact mutation by hand leaves the whole suite (406 tests) passing.
  const valid = value === "" || (typeof value === "string" && allowed.includes(value))
  if (!valid) {
    errors.push(
      `${at} must be "" or one of ${allowed.map((v) => JSON.stringify(v)).join(", ")} (got ${JSON.stringify(value)}).`,
    )
  }
  return valid
}

/** @internal Exported for direct unit coverage: see this module's own doc comment. */
export const SOCKET_EXCEPTION_SCHEMA: ExceptionRegistrySchema<SocketExceptionRecord> = {
  namespace: "socket:",
  metadataKeys: [...SECURITY_EXCEPTION_FIELD_KEYS, "package", "packageVersion", "type", "severity"],
  validateRecord(core: ExceptionRecordCore, raw, index, errors) {
    const at = `exceptions[${String(index)}]`
    const security = validateSecurityExceptionFields(raw, index, SOCKET_EXCEPTION_TYPES, errors)

    const { package: pkg, packageVersion, type, severity } = raw
    const pkgValid = isValidNonEmptyStringField(pkg, `${at}.package`, errors)
    const versionValid = isValidNonEmptyStringField(packageVersion, `${at}.packageVersion`, errors)
    const typeValid = isValidNonEmptyStringField(type, `${at}.type`, errors)
    const severityValid = isValidOptionalEnumField(
      severity,
      `${at}.severity`,
      [...RECORD_SEVERITY_VALUES],
      errors,
    )

    if (security === undefined || !pkgValid || !versionValid || !typeValid || !severityValid) {
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
      ...security,
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
  ...EXCEPTION_V2_FIELD_KEYS,
]

/**
 * Critical and high alerts are never waivable; every other alert (supply-chain risks included)
 * needs a complete, finding-specific exception.
 */
const SOCKET_POLICY: ExceptionPolicyConfig = {
  socket: {
    rules: {
      critical: { mode: "forbidden" },
      high: { mode: "forbidden" },
      middle: { mode: "exception", requirements: [...AUTHORING_REQUIREMENTS_FULL] },
      low: { mode: "exception", requirements: [...AUTHORING_REQUIREMENTS_FULL] },
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
  ...EXCEPTION_V2_FIELD_KEYS,
] as const

/** @internal Exported for direct unit coverage: see this module's own doc comment. */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
/** @internal Exported for direct unit coverage: see this module's own doc comment. */
export function safeString(value: unknown): string {
  return typeof value === "string" ? value : ""
}

/**
 * Recognizes Socket's own "not authenticated" JSON envelope: `{ "ok": false, "message": "Auth Error", ... }`.
 * @internal Exported for direct unit coverage: see this module's own doc comment.
 */
export function isAuthError(parsed: unknown): boolean {
  return (
    isPlainObject(parsed) &&
    parsed["ok"] === false &&
    (parsed["message"] === "Auth Error" || parsed["message"] === "AuthError")
  )
}

/** The HTTP-style `data.code` of a failed Socket envelope (compared strictly, so any type is safe). */
function failureCode(parsed: unknown): unknown {
  if (!isPlainObject(parsed)) return undefined
  const data = parsed["data"]
  return isPlainObject(data) ? data["code"] : undefined
}

/**
 * Maps a failed `socket package score` envelope (or raw stderr) to the problem a contributor can act on.
 * @internal Exported for direct unit coverage: see this module's own doc comment.
 */
export function classifyProblem(stderr: string, parsed: unknown): SocketProblem | undefined {
  const code = failureCode(parsed)
  if (code === 401 || code === 403) return "token-rejected"
  if (isAuthError(parsed)) return "not-authenticated"
  if (code === 429) return "rate-limited"
  if (code === "ENOENT") return "cli-not-installed"
  const NETWORK_ERROR_CODES = /\b(ENOTFOUND|ETIMEDOUT|ECONNREFUSED|ECONNRESET|EAI_AGAIN)\b/
  if (NETWORK_ERROR_CODES.test(stderr)) return "network-unreachable"
  if (isPlainObject(parsed) && parsed["ok"] === false) {
    const text = `${safeString(parsed["message"])} ${safeString(parsed["cause"])}`
    if (NETWORK_ERROR_CODES.test(text) || /network|unreachable|could not connect/i.test(text)) {
      return "network-unreachable"
    }
  }
  return undefined
}

/** The `packageVersion` of an alert on the scored package itself (see `normalizeAlert`). */
const SELF_VERSION = "self"

/**
 * Splits a Socket alert example such as `npm/@scope/pkg@1.2.3` into package and version.
 * @internal Exported for direct unit coverage: see this module's own doc comment.
 */
export function parseExample(
  example: string,
): { readonly name: string; readonly version: string } | undefined {
  const withoutEcosystem = example.startsWith("npm/") ? example.slice("npm/".length) : example
  const at = withoutEcosystem.lastIndexOf("@")
  return at < 1 || at === withoutEcosystem.length - 1
    ? undefined
    : { name: withoutEcosystem.slice(0, at), version: withoutEcosystem.slice(at + 1) }
}

/**
 * Normalizes one flattened `socket-package-score` alert (`{ name, severity, category, example }`).
 * @internal Exported for direct unit coverage: see this module's own doc comment.
 */
export function normalizeAlert(
  raw: unknown,
  selfPackage?: string,
): NormalizedSocketAlert | undefined {
  if (!isPlainObject(raw)) return undefined
  const { name, example, severity: severityRaw, category, scope } = raw
  if (typeof name !== "string" || name.length === 0) return undefined
  if (typeof example !== "string") return undefined
  const subject = parseExample(example)
  if (subject === undefined) return undefined
  const severity =
    typeof severityRaw === "string" && RAW_SEVERITY_VALUES.has(severityRaw.toLowerCase())
      ? (severityRaw.toLowerCase() as "critical" | "high" | "middle" | "low")
      : "unknown"
  // The package's own alerts are keyed by the stable word "self", not its version: the scored
  // version changes with every release, and a version in the id would orphan every record each time.
  const version = scope === "self" || subject.name === selfPackage ? SELF_VERSION : subject.version
  return {
    id: deriveSocketExceptionId({
      package: subject.name,
      packageVersion: version,
      type: name,
    }),
    package: subject.name,
    version,
    type: name,
    severity,
    category: typeof category === "string" ? category : "",
  }
}

/** @internal Exported for direct unit coverage: see this module's own doc comment. */
export function evaluateAlert(
  alert: NormalizedSocketAlert,
  record: SocketExceptionRecord | undefined,
): {
  readonly verdict: "forbidden" | "insufficient" | "permitted" | "unmatched"
  readonly missing: readonly string[]
} {
  const classifications: readonly [ExceptionClassification, ...ExceptionClassification[]] = [
    { group: "socket", category: alert.severity },
  ]
  return evaluateFindingVerdict(
    record,
    classifications,
    SOCKET_POLICY,
    SOCKET_GLOBAL_DEFAULT_POLICY,
  )
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

/** The outcome of running and interpreting the score script itself, before any registry work. */
type SocketRunOutcome =
  | { readonly kind: "fail" | "pass" | "warn"; readonly rationale: string }
  /** The scan could not run for a reason the environment explains (no API key): a degradation, recorded or not. */
  | { readonly kind: "degraded"; readonly code: string; readonly rationale: string }
  | {
      readonly kind: "ok"
      readonly alerts: readonly NormalizedSocketAlert[]
      readonly note: string
    }

/** Everything a CI run or a developer machine may export, narrowed to what the guidance reads. */
type Env = Readonly<Record<string, string | undefined>>

/**
 * Parses stdout as JSON; `null` when it is not (a literal JSON `null` is equally unusable).
 * @param stdout - the script's raw stdout.
 */
function parseEnvelope(stdout: string): unknown {
  try {
    return JSON.parse(stdout) as unknown
  } catch {
    return null
  }
}

/**
 * Interprets the score script's single JSON envelope. A missing API key warns, and every other
 * recognized "Socket could not run" state fails, each with environment-specific steps (see
 * `./socket-guidance.ts`). Only a genuine, well-formed alert list (or a package with nothing
 * published to score) gets past this point.
 * @param result - the script's raw evidence.
 * @param env - the environment to inspect for CI (`process.env` in production).
 * @internal Exported for direct unit coverage: see this module's own doc comment.
 */
export function interpretSocketRun(result: CheckEvidence, env: Env): SocketRunOutcome {
  const terminated = abnormalTermination(result, "socket-package-score")
  if (terminated) return { kind: "fail", rationale: terminated }

  const parsed = parseEnvelope(result.stdout)
  if (parsed === null) {
    const problem = classifyProblem(result.stderr, undefined)
    return {
      kind: "fail",
      rationale:
        problem === undefined
          ? `The Socket score script produced no parseable JSON output (exit code ${String(result.exitCode)}).`
          : socketGuidance(problem, env),
    }
  }
  if (!isPlainObject(parsed) || typeof parsed["ok"] !== "boolean") {
    return {
      kind: "fail",
      rationale: 'The Socket score script produced JSON with no recognized "ok" boolean field.',
    }
  }
  if (!parsed["ok"]) {
    const problem = classifyProblem(result.stderr, parsed)
    if (problem === "not-authenticated") {
      // No API key, here or in CI: the scan did not run, so this is a degradation, not a finding. Locally
      // it is a warning with the steps to get a key. In CI (--strict) it fails unless
      // `.repo-contract/exceptions/environment.json` records `environment:SecuritySocket:no-key`. `init`
      // writes that record with a 90-day expiry, so a new package is green on day one and decides later.
      // A key that is present and refused still fails outright.
      return {
        kind: "degraded",
        code: "no-key",
        rationale: `the Socket scan did not run, so its alerts were not checked.\n${socketGuidance(problem, env)}`,
      }
    }
    if (problem !== undefined) return { kind: "fail", rationale: socketGuidance(problem, env) }
    const detail = [safeString(parsed["message"]), safeString(parsed["cause"])]
      .filter((part) => part.length > 0)
      .join(": ")
    return {
      kind: "fail",
      rationale: `security-socket scan failed: ${detail.length > 0 ? detail : "unrecognized failure"}.`,
    }
  }

  const data = parsed["data"]
  if (!isPlainObject(data)) {
    return {
      kind: "fail",
      rationale: "The Socket score script reported success without a data object.",
    }
  }
  if (typeof data["skipped"] === "string") {
    return { kind: "pass", rationale: `Socket scan skipped: ${data["skipped"]}.` }
  }
  if (data["unpublished"] === true) {
    return {
      kind: "pass",
      rationale:
        "Socket scan has nothing to score yet: the package is not published. DistNoUrls and NoMinify gate what is about to ship; this check gates it from its first publish on.",
    }
  }
  const rawAlerts = data["alerts"]
  if (!Array.isArray(rawAlerts)) {
    return { kind: "fail", rationale: 'The Socket score script\'s "alerts" is not an array.' }
  }
  const selfPackage = safeString(data["package"])
  const normalized = rawAlerts.map((raw) => normalizeAlert(raw, selfPackage))
  const malformedIndex = normalized.findIndex((alert) => alert === undefined)
  if (malformedIndex !== -1) {
    return {
      kind: "fail",
      rationale: `The Socket score script reported an alert (index ${String(malformedIndex)}) missing its name or example package@version.`,
    }
  }
  const unique = new Map((normalized as NormalizedSocketAlert[]).map((alert) => [alert.id, alert]))
  const scored = safeString(data["scoredVersion"])
  const requested = safeString(data["requestedVersion"])
  const note =
    scored !== "" && requested !== "" && scored !== requested
      ? ` (scored the latest published version ${scored}; ${requested} is not on Socket yet)`
      : ""
  return { kind: "ok", alerts: [...unique.values()], note }
}

/**
 * The final pass/fail composition, once every alert has a reconciled (possibly freshly-scaffolded) record to evaluate against.
 * @internal Exported for direct unit coverage: see this module's own doc comment.
 */
export function evaluateFinalVerdict(
  alerts: readonly NormalizedSocketAlert[],
  registry: PersistedExceptionRegistry<SocketExceptionRecord>,
): PolicyResult {
  const configErrors = validateExceptionPolicyConfig(SOCKET_POLICY, VALID_SOCKET_REQUIREMENTS)
  // Stryker disable all -- SOCKET_POLICY/VALID_SOCKET_REQUIREMENTS are fixed, valid module
  // constants (see their own definitions above); this defensive guard can never observe a
  // misconfigured policy under any real invocation of this function, since it never varies at
  // runtime. No test can hit it without literally breaking those constants. Kept as
  // defense-in-depth against a future editing mistake in SOCKET_POLICY itself.
  if (configErrors.length > 0) {
    return {
      outcome: "fail",
      rationale: ["SOCKET_POLICY is misconfigured:", ...configErrors.map((e) => `- ${e}`)].join(
        "\n",
      ),
    }
  }
  // Stryker restore all

  const activeById = new Map(registry.activeRecords.map((r) => [r.id, r]))
  const staleLines = registry.staleRecords.map(
    (record) =>
      `- Stale exception in ${REGISTRY_RELATIVE_PATH}: ${JSON.stringify(record.id)}; Socket no longer raises this alert; delete this entry.`,
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
    run: ["node", SCRIPT_PATH],
    policy: async ({ result }): Promise<PolicyResult> => {
      const run = interpretSocketRun(result, process.env)
      if (run.kind === "degraded") {
        return degraded({ check: "SecuritySocket", code: run.code, rationale: run.rationale })
      }
      if (run.kind !== "ok") return { outcome: run.kind, rationale: run.rationale }

      const registryPath = path.join(process.cwd(), REGISTRY_RELATIVE_PATH)
      const persisted = await loadAndReconcileExceptionRegistry(
        registryPath,
        REGISTRY_RELATIVE_PATH,
        registrySchema,
        run.alerts,
        createSocketStub,
      )
      if (!persisted.ok) return { outcome: "fail", rationale: persisted.rationale }

      const verdict = evaluateFinalVerdict(run.alerts, persisted.registry)
      return { ...verdict, rationale: `${verdict.rationale}${run.note}` }
    },
  }
}
