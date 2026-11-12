/**
 * `CodeScanning`: every open GitHub code-scanning alert on this ref is fixed, or sits in
 * development-only code and is rejected by a committed record.
 *
 * Reads: the open alerts of the current ref through `gh api`, by way of
 * `scripts/code-scanning-alerts.mjs`. Locally that is a person's `gh` login and the checked-out
 * branch. In CI it is `GH_TOKEN` or `GITHUB_TOKEN`, `GITHUB_REPOSITORY` and `GITHUB_REF`, and the
 * job needs `permissions: security-events: read`. Also package.json `files`, and
 * `.repo-contract/exceptions/code-scanning.json`. A ref with no analysis yet has no alerts, so a
 * fix branch is never blocked by the default branch's open alert.
 *
 * Fails on any alert in code that builds, runs or ships. Development-only code is `test/`,
 * `tests/`, `examples/`, `benchmarks/`, `docs/`, `.github/`, `scripts/` and the test and config
 * file patterns, minus anything package.json `files` publishes. Fails when a development-only alert
 * has an incomplete record. Fails when the registry cannot be loaded or written. Fails when the
 * alerts could not be read: no token, `gh` missing, not signed in, no access, too many pages. Never
 * warns on a finding.
 *
 * Exceptions: only for development-only code. The id is `code-scanning:<rule>@<path>`, with `rule`
 * and `path` fields, `exceptionType` `dev-only-not-shipped` and `method` `policy-rule`. The check
 * writes that record fully for each such alert. A shipped alert has no exception. Two degradations
 * exist: scanning not enabled (`CodeScanning:not-enabled`) and no GitHub remote
 * (`CodeScanning:no-remote`). Each warns locally. Under `--strict`, the CI default, each fails
 * unless `.repo-contract/exceptions/environment.json` holds a complete record. The record id is
 * `environment:CodeScanning:<code>`.
 *
 * Runs in the consumer `contract` job, in both git hooks, and in IPC's own self-contract.
 *
 * Example record (one covers every alert of a rule in a file):
 *
 * ```json
 * {
 *   "exceptions": [
 *     {
 *       "id": "code-scanning:js/bad-tag-filter@test/build/banner.test.ts",
 *       "version": 2,
 *       "justification": "Development-only code (tests, scripts, docs, CI configuration) is never built, run by users or published, so a finding in it cannot reach anyone.",
 *       "alternatives": "Rewrite the flagged code to satisfy the rule.",
 *       "remediation": "None needed while the code stays development-only.",
 *       "method": "policy-rule",
 *       "exceptionType": "dev-only-not-shipped",
 *       "ruleBroken": "Every open code-scanning alert must be fixed before merge.",
 *       "attempted": "Judged by location, not by alert: ...",
 *       "constraint": "The flagged code only exists to test, document, configure or automate the package; ...",
 *       "whyPreferable": "Rewriting test and tooling code ...",
 *       "residualRisk": "None for users, since the file is never built or published.",
 *       "revisitWhen": "The file is added to package.json `files`, or moves under src/ or bin/.",
 *       "expires": "",
 *       "rule": "js/bad-tag-filter",
 *       "path": "test/build/banner.test.ts"
 *     }
 *   ]
 * }
 * ```
 */
import { readFile } from "node:fs/promises"
import path from "node:path"
import type { CheckDefinitionConfig, PolicyResult } from "repo-contract"
import type {
  ExceptionPolicyConfig,
  ExceptionRecordCore,
  StandardSchemaV1,
} from "repo-contract/helpers"
import {
  CODE_SCANNING_EXCEPTION_TYPES,
  EXCEPTION_V2_FIELD_KEYS,
  SECURITY_EXCEPTION_FIELD_KEYS,
  emptyV2Fields,
  evaluateFindingVerdict,
  isValidNonEmptyStringField,
  loadAndReconcileExceptionRegistry,
  validateExceptionRegistry,
  validateSecurityExceptionFields,
} from "./exception-record.js"
import { degraded } from "./environment-exceptions.js"
import type {
  ExceptionMethod,
  ExceptionRegistrySchema,
  ExceptionType,
  ExceptionV2Fields,
} from "./exception-record.js"
import { packageRoot, parseToolEnvelope } from "./shared.js"

const scriptPath = path.join(packageRoot, "scripts", "code-scanning-alerts.mjs")
const REGISTRY_RELATIVE_PATH = ".repo-contract/exceptions/code-scanning.json"
const MAX_LISTED = 20

/** The one reason recorded for every development-only alert, so the standing decision reads identically. */
const DEV_JUSTIFICATION =
  "Development-only code (tests, scripts, docs, CI configuration) is never built, run by users or published, so a finding in it cannot reach anyone."
const DEV_ALTERNATIVES = "Rewrite the flagged code to satisfy the rule."
const DEV_REMEDIATION = "None needed while the code stays development-only."
const DEV_RULE_BROKEN = "Every open code-scanning alert must be fixed before merge."
const DEV_ATTEMPTED =
  "Judged by location, not by alert: the file is development-only (a dev directory or file pattern, and not covered by package.json `files`). No per-alert fix was attempted."
const DEV_CONSTRAINT =
  "The flagged code only exists to test, document, configure or automate the package; it often contains the flagged pattern on purpose (a fixture, an example)."
const DEV_WHY_PREFERABLE =
  "Rewriting test and tooling code to satisfy a rule meant for shipped code costs more than the nothing it protects: no user ever runs it."
const DEV_RESIDUAL_RISK =
  "None for users, since the file is never built or published. A contributor running the code locally could still exercise the flagged behavior."
const DEV_REVISIT_WHEN =
  "The file is added to package.json `files`, or moves under src/ or bin/ (the check then rejects the alert with no exception)."

/** Where development-only code lives; a path anywhere else builds, runs or ships. */
const DEV_PREFIXES = [
  "test/",
  "tests/",
  "examples/",
  "benchmarks/",
  "docs/",
  ".github/",
  "scripts/",
] as const
const DEV_PATTERNS = [
  /\.(?:test|spec)\.[cm]?[jt]sx?$/,
  /(?:^|\/)__(?:tests|mocks)__\//,
  /(?:^|\/)[^/]*\.config\.[cm]?[jt]s$/,
] as const

/** One open alert, as the script reports it. */
interface CodeScanningAlert {
  readonly number: number
  readonly rule: string
  readonly severity: string
  readonly path: string
  readonly line: number
  readonly tool: string
  readonly message: string
}

interface AlertsReport {
  readonly ok: boolean
  readonly message?: string
  readonly data?: {
    readonly kind?: string
    readonly skipped?: string
    readonly alerts?: readonly CodeScanningAlert[]
  }
}

/** One distinct (rule, file) a record can cover. */
interface Finding {
  readonly id: string
  readonly rule: string
  readonly path: string
}

interface CodeScanningRecord extends Partial<ExceptionV2Fields> {
  readonly id: string
  readonly version: 1 | 2
  readonly justification: string
  readonly alternatives: string
  readonly remediation: string
  readonly method: "" | ExceptionMethod
  readonly exceptionType: "" | ExceptionType
  readonly rule: string
  readonly path: string
}

/** `code-scanning:<rule>@<path>` -- stable while the rule and file are unchanged. */
export function deriveCodeScanningId(rule: string, filePath: string): string {
  return `code-scanning:${rule}@${filePath}`
}

/**
 * Whether `filePath` is development-only code: under a dev directory or matching a dev file pattern,
 * and NOT covered by one of the package's published `files` entries (a published `scripts/` is shipped).
 * @param filePath - repo-relative, forward-slash path of the alert.
 * @param publishedEntries - the package.json `files` entries.
 * @internal Exported for direct unit coverage.
 */
export function isDevPath(filePath: string, publishedEntries: readonly string[]): boolean {
  const published = publishedEntries.some((entry) => {
    const bare = entry.replace(/^\.\//, "").replace(/\/(?:\*\*?)?$/, "")
    return filePath === bare || filePath.startsWith(`${bare}/`)
  })
  if (published) return false
  return (
    DEV_PREFIXES.some((prefix) => filePath.startsWith(prefix)) ||
    DEV_PATTERNS.some((pattern) => pattern.test(filePath))
  )
}

/** A fully written record for a development-only finding. @internal Exported for direct unit coverage. */
export function createDevStub(finding: Finding, id: string): CodeScanningRecord {
  return {
    id,
    version: 2,
    justification: DEV_JUSTIFICATION,
    alternatives: DEV_ALTERNATIVES,
    remediation: DEV_REMEDIATION,
    // No person reviewed this: the standing location rule in this check decided it, and the record says so.
    method: "policy-rule",
    exceptionType: "dev-only-not-shipped",
    ...emptyV2Fields(),
    ruleBroken: DEV_RULE_BROKEN,
    attempted: DEV_ATTEMPTED,
    constraint: DEV_CONSTRAINT,
    whyPreferable: DEV_WHY_PREFERABLE,
    residualRisk: DEV_RESIDUAL_RISK,
    revisitWhen: DEV_REVISIT_WHEN,
    rule: finding.rule,
    path: finding.path,
  }
}

/** @internal Exported for direct unit coverage. */
export const CODE_SCANNING_SCHEMA: ExceptionRegistrySchema<CodeScanningRecord> = {
  namespace: "code-scanning:",
  metadataKeys: [...SECURITY_EXCEPTION_FIELD_KEYS, "rule", "path"],
  validateRecord(core: ExceptionRecordCore, raw, index, errors) {
    const at = `exceptions[${String(index)}]`
    const security = validateSecurityExceptionFields(
      raw,
      index,
      CODE_SCANNING_EXCEPTION_TYPES,
      errors,
    )
    const { rule, path: recordPath } = raw
    const ruleValid = isValidNonEmptyStringField(rule, `${at}.rule`, errors)
    const pathValid = isValidNonEmptyStringField(recordPath, `${at}.path`, errors)
    if (security === undefined || !ruleValid || !pathValid) return undefined

    const derived = deriveCodeScanningId(rule, recordPath)
    if (derived !== core.id) {
      errors.push(
        `${at}.id ${JSON.stringify(core.id)} does not match the id derived from its own rule and path (${JSON.stringify(derived)}).`,
      )
      return undefined
    }
    return {
      id: core.id,
      version: 1,
      justification: core.justification,
      ...security,
      rule,
      path: recordPath,
    }
  },
}

const registrySchema: StandardSchemaV1<unknown, readonly CodeScanningRecord[]> = {
  "~standard": {
    version: 1,
    vendor: "internal-package-contract",
    validate: (value: unknown) => {
      const result = validateExceptionRegistry(value, CODE_SCANNING_SCHEMA)
      return result.ok
        ? { value: result.records }
        : { issues: result.errors.map((message) => ({ message })) }
    },
  },
}

const REQUIREMENTS = [
  "justification",
  "alternatives",
  "remediation",
  "method",
  "exceptionType",
  ...EXCEPTION_V2_FIELD_KEYS,
]
const POLICY: ExceptionPolicyConfig = {
  "code-scanning": {
    rules: { dev: { mode: "exception", requirements: [...REQUIREMENTS] } },
  },
}

/** Steps for the one situation each failure kind means. */
function guidance(kind: string | undefined, message: string | undefined): string {
  const steps =
    kind === "no-token"
      ? [
          "In the contract workflow job add `permissions: { contents: read, security-events: read }`.",
          "Pass the token to the step that runs the contract: `env: { GH_TOKEN: ${{ github.token }} }`.",
        ]
      : kind === "truncated"
        ? [
            message ?? "The alert list is too long to read in full.",
            "Triage the open alerts on GitHub first.",
          ]
        : kind === "gh-not-installed"
          ? [
              "Install the GitHub CLI: https://cli.github.com (macOS: `brew install gh`).",
              "Sign in: `gh auth login`.",
              "Allow it to read code scanning: `gh auth refresh -s security_events`.",
            ]
          : kind === "not-authenticated"
            ? [
                "Sign in: `gh auth login`.",
                "Allow it to read code scanning: `gh auth refresh -s security_events`.",
              ]
            : kind === "no-access"
              ? [
                  "Your gh login cannot read this repository's code-scanning alerts.",
                  "Allow it: `gh auth refresh -s security_events`, and use an account with access to the repository.",
                ]
              : [`GitHub's answer could not be read${message ? `: ${message}` : "."}`]
  return [
    "Code scanning could not be reviewed:",
    ...steps.map((step, index) => `  ${String(index + 1)}. ${step}`),
    "Re-run `npm run contract`. This check never passes without reading the alerts.",
  ].join("\n")
}

async function publishedEntries(): Promise<readonly string[]> {
  try {
    // Stryker disable next-line StringLiteral: an equivalent mutant -- `readFile(path, "")` yields a Buffer, which `JSON.parse` coerces to the same text.
    const text = await readFile(path.join(process.cwd(), "package.json"), "utf8")
    const files = (JSON.parse(text) as { files?: unknown }).files
    // Stryker disable next-line ArrayDeclaration: an equivalent mutant -- a placeholder entry matches no path, same as none.
    return Array.isArray(files) ? files.filter((f): f is string => typeof f === "string") : []
  } catch {
    // Stryker disable next-line ArrayDeclaration: an equivalent mutant -- a placeholder entry matches no path, same as none.
    return []
  }
}

/** @returns the `CodeScanning` check. */
export function codeScanning(): CheckDefinitionConfig {
  return {
    run: ["node", scriptPath],
    output: { format: "json" },
    policy: async ({ result }): Promise<PolicyResult> => {
      const envelope = parseToolEnvelope<AlertsReport>(
        result,
        "code-scanning-alerts",
        "Code scanning:",
      )
      if (!envelope.ok) return envelope.result
      const report = envelope.value

      if (!report.ok) {
        return { outcome: "fail", rationale: guidance(report.data?.kind, report.message) }
      }
      const skipped = report.data?.skipped
      if (skipped !== undefined) {
        // The alerts were not read, so nothing was reviewed: a degradation, not a pass. Locally a warning;
        // in CI (--strict) a failure unless environment.json records why this repository has no code
        // scanning (`not-enabled`) or no GitHub remote (`no-remote`).
        const code = /not enabled/.test(skipped) ? "not-enabled" : "no-remote"
        return degraded({
          check: "CodeScanning",
          code,
          rationale: `Code scanning review skipped: ${skipped}.`,
        })
      }

      const alerts = report.data?.alerts ?? []
      const entries = await publishedEntries()
      const shipped = alerts.filter((alert) => !isDevPath(alert.path, entries))
      if (shipped.length > 0) {
        const lines = shipped
          .slice(0, MAX_LISTED)
          .map(
            (alert) =>
              `- ${alert.rule} in ${alert.path}:${String(alert.line)} [${alert.severity}]: ${alert.message}`,
          )
        const more =
          shipped.length > MAX_LISTED
            ? [`- ...and ${String(shipped.length - MAX_LISTED)} more`]
            : []
        return {
          outcome: "fail",
          rationale: [
            `${String(shipped.length)} open code-scanning alert(s) are in code that builds, runs or ships, so they must be fixed (there is no exception for them):`,
            ...lines,
            ...more,
          ].join("\n"),
        }
      }

      const findings = [
        ...new Map(
          alerts.map((alert) => [
            deriveCodeScanningId(alert.rule, alert.path),
            {
              id: deriveCodeScanningId(alert.rule, alert.path),
              rule: alert.rule,
              path: alert.path,
            },
          ]),
        ).values(),
      ]
      const persisted = await loadAndReconcileExceptionRegistry(
        path.join(process.cwd(), REGISTRY_RELATIVE_PATH),
        REGISTRY_RELATIVE_PATH,
        registrySchema,
        findings,
        createDevStub,
      )
      if (!persisted.ok) return { outcome: "fail", rationale: persisted.rationale }

      const activeById = new Map(
        persisted.registry.activeRecords.map((record) => [record.id, record]),
      )
      const incomplete = findings.filter(
        (finding) =>
          evaluateFindingVerdict(
            activeById.get(finding.id),
            [{ group: "code-scanning", category: "dev" }],
            POLICY,
            // Stryker disable next-line ObjectLiteral,StringLiteral: equivalent mutants -- the classification above always names a configured group and category, so this fallback is never consulted.
            { mode: "forbidden" },
          ).verdict !== "permitted",
      )
      if (incomplete.length > 0) {
        return {
          outcome: "fail",
          rationale: [
            `${String(incomplete.length)} development-only finding(s) have an incomplete record in ${REGISTRY_RELATIVE_PATH}:`,
            ...incomplete.map((finding) => `- ${finding.id}`),
          ].join("\n"),
        }
      }
      return {
        outcome: "pass",
        rationale:
          alerts.length === 0
            ? "No open code-scanning alerts."
            : `${String(alerts.length)} open code-scanning alert(s), all in development-only code and rejected by a record in ${REGISTRY_RELATIVE_PATH}.`,
      }
    },
  }
}
