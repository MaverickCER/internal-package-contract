/**
 * Supply-chain alert scanning from Socket.dev, evaluated against the package's own Socket page.
 *
 * `run` executes `scripts/socket-package-score.mjs`, which wraps `socket package score` -- the same
 * data the package's page on socket.dev shows, for the package itself AND its whole transitive
 * closure (peer dependencies included). It deliberately does NOT use `socket ci`: that scans repo
 * manifests against the org policy and by default reports only "error"-level alerts, so it returned
 * `healthy: true, alerts: {}` for a package whose page showed `urlStrings`, `minifiedFile`,
 * `shellAccess`, `usesEval` and more (confirmed on data-cap). The script scores the current
 * `package.json` version, falls back to the latest published version when Socket has no result
 * for it yet, and passes vacuously for a private or never-published package (DistNoUrls and
 * NoMinify gate what is about to ship; this check gates what is already out and its closure).
 *
 * ## Policy
 *
 * - `critical`/`high` alerts are `forbidden` outright.
 * - **Any `supplyChainRisk` alert, at any severity, is `forbidden` outright** -- the score covers
 *   only what actually ships (dependencies and peers, not devDependencies), so every such alert is
 *   shipped by construction. Nothing can waive it: remove or replace the dependency, or fix the
 *   package's own code.
 * - Everything else (`middle`/`low` quality, maintenance, license, vulnerability, unknown) is
 *   waivable only via a finding-specific, fully-written record in
 *   `.repo-contract/exceptions/socket.json` (the shared exception-policy primitive from
 *   `repo-contract/helpers`). A `low` waiver drops the `alternatives`/`remediation` prose.
 * - **The scan can never be skipped silently.** CLI not installed, not signed in, token rejected,
 *   network down and rate limiting all FAIL, with steps that differ between CI and a developer
 *   machine (see `./socket-guidance.ts`).
 *
 * Example record (id is `socket:<package>@<version>:<alert name>`):
 *
 * ```json
 * {
 *   "exceptions": [
 *     {
 *       "id": "socket:data-cap@0.4.0:unpopularPackage",
 *       "version": 1,
 *       "justification": "A new package with few downloads yet; popularity is not something code can change.",
 *       "alternatives": "None -- publishing is the way to gain adoption.",
 *       "remediation": "Resolves itself as the package is adopted.",
 *       "method": "independent-human-review",
 *       "exceptionType": "accepted-risk",
 *       "package": "data-cap",
 *       "packageVersion": "0.4.0",
 *       "type": "unpopularPackage",
 *       "severity": "middle"
 *     }
 *   ]
 * }
 * ```
 *
 * The registry is reconciled every run: a blank stub is scaffolded for a genuinely new alert and a
 * record with no matching alert this run is reported stale, via the same
 * `reconcileExceptions`/`writeExceptionRegistry` (`repo-contract/helpers`) primitives.
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
  EXCEPTION_TYPES,
  SECURITY_EXCEPTION_FIELD_KEYS,
  evaluateFindingVerdict,
  isValidNonEmptyStringField,
  loadAndReconcileExceptionRegistry,
  validateExceptionRegistry,
  validateSecurityExceptionFields,
} from "./exception-record.js"
import type {
  ExceptionRegistrySchema,
  ExceptionMethod,
  ExceptionType,
  PersistedExceptionRegistry,
} from "./exception-record.js"
import { abnormalTermination, packageRoot } from "./shared.js"
import { socketGuidance } from "./socket-guidance.js"
import type { SocketProblem } from "./socket-guidance.js"

const SCRIPT_PATH = path.join(packageRoot, "scripts", "socket-package-score.mjs")
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
  /** Socket's own alert category (`supplyChainRisk`, `quality`, `license`, ...). */
  readonly category: string
}

/** One `.repo-contract/exceptions/socket.json` record: the shared security-family fields (`./exception-record.js`) plus this registry's own identity fields. */
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

/**
 * `socket:<package>@<version>:<type>` -- injective over a run (Socket does not emit the same package@version:type twice), stable across runs while the dependency and alert type are unchanged.
 * @internal Exported for direct unit coverage -- see this module's own doc comment.
 */
export function deriveSocketExceptionId(alert: {
  readonly package: string
  readonly packageVersion: string
  readonly type: string
}): string {
  return `socket:${alert.package}@${alert.packageVersion}:${alert.type}`
}

/**
 * A fresh, blank exception record for an alert with no matching record yet -- every authoring field starts empty (valid registry data, only policy-insufficient).
 * @internal Exported for direct unit coverage -- see this module's own doc comment.
 */
export function createSocketStub(alert: NormalizedSocketAlert, id: string): SocketExceptionRecord {
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

/**
 * `value` is `""` or one of `allowed` -- pushes a descriptive message onto `errors` otherwise.
 * @internal Exported for direct unit coverage -- see this module's own doc comment.
 */
export function isValidOptionalEnumField(
  value: unknown,
  at: string,
  allowed: readonly string[],
  errors: string[],
): boolean {
  // Stryker disable next-line ConditionalExpression: replacing `typeof value === "string"` with
  // `true` is behaviorally equivalent here -- `allowed` is typed `readonly string[]`, so
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

/** @internal Exported for direct unit coverage -- see this module's own doc comment. */
export const SOCKET_EXCEPTION_SCHEMA: ExceptionRegistrySchema<SocketExceptionRecord> = {
  namespace: "socket:",
  metadataKeys: [...SECURITY_EXCEPTION_FIELD_KEYS, "package", "packageVersion", "type", "severity"],
  validateRecord(core: ExceptionRecordCore, raw, index, errors) {
    const at = `exceptions[${String(index)}]`
    const security = validateSecurityExceptionFields(raw, index, EXCEPTION_TYPES, errors)

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
]
const AUTHORING_REQUIREMENTS_LIGHT = ["justification", "method", "exceptionType"]

/**
 * Above medium severity is never waivable, and neither is ANY supply-chain-risk alert at any
 * severity (the score covers only what ships, so every such alert is shipped by construction);
 * everything else needs a complete, finding-specific exception.
 */
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
  "socket-category": {
    rules: { supplyChainRisk: { mode: "forbidden" } },
    default: { mode: "allowed" },
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

/** @internal Exported for direct unit coverage -- see this module's own doc comment. */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
/** @internal Exported for direct unit coverage -- see this module's own doc comment. */
export function safeString(value: unknown): string {
  return typeof value === "string" ? value : ""
}

/**
 * Recognizes Socket's own "not authenticated" JSON envelope: `{ "ok": false, "message": "Auth Error", ... }`.
 * @internal Exported for direct unit coverage -- see this module's own doc comment.
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
 * @internal Exported for direct unit coverage -- see this module's own doc comment.
 */
export function classifyProblem(stderr: string, parsed: unknown): SocketProblem | undefined {
  if (isAuthError(parsed)) return "not-authenticated"
  const code = failureCode(parsed)
  if (code === 401 || code === 403) return "token-rejected"
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

/**
 * Splits a Socket alert example such as `npm/@scope/pkg@1.2.3` into package and version.
 * @internal Exported for direct unit coverage -- see this module's own doc comment.
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
 * @internal Exported for direct unit coverage -- see this module's own doc comment.
 */
export function normalizeAlert(raw: unknown): NormalizedSocketAlert | undefined {
  if (!isPlainObject(raw)) return undefined
  const { name, example, severity: severityRaw, category } = raw
  if (typeof name !== "string" || name.length === 0) return undefined
  if (typeof example !== "string") return undefined
  const subject = parseExample(example)
  if (subject === undefined) return undefined
  const severity =
    typeof severityRaw === "string" && RAW_SEVERITY_VALUES.has(severityRaw.toLowerCase())
      ? (severityRaw.toLowerCase() as "critical" | "high" | "middle" | "low")
      : "unknown"
  return {
    id: deriveSocketExceptionId({
      package: subject.name,
      packageVersion: subject.version,
      type: name,
    }),
    package: subject.name,
    version: subject.version,
    type: name,
    severity,
    category: typeof category === "string" ? category : "",
  }
}

/** @internal Exported for direct unit coverage -- see this module's own doc comment. */
export function evaluateAlert(
  alert: NormalizedSocketAlert,
  record: SocketExceptionRecord | undefined,
): {
  readonly verdict: "forbidden" | "insufficient" | "permitted" | "unmatched"
  readonly missing: readonly string[]
} {
  const classifications: readonly [ExceptionClassification, ...ExceptionClassification[]] = [
    { group: "socket", category: alert.severity },
    { group: "socket-category", category: alert.category },
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
  | { readonly kind: "fail" | "pass"; readonly rationale: string }
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
 * Interprets the score script's single JSON envelope -- every recognized "Socket could not run"
 * state fails with environment-specific steps (see `./socket-guidance.ts`); only a genuine,
 * well-formed alert list (or a package with nothing published to score) gets past this point.
 * @param result - the script's raw evidence.
 * @param env - the environment to inspect for CI (`process.env` in production).
 * @internal Exported for direct unit coverage -- see this module's own doc comment.
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
  const normalized = rawAlerts.map((raw) => normalizeAlert(raw))
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
 * @internal Exported for direct unit coverage -- see this module's own doc comment.
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
        ? d.alert.category === "supplyChainRisk"
          ? "forbidden by policy (supply-chain risk -- remove or replace the dependency, or fix the code)"
          : "forbidden by policy (above medium severity)"
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
