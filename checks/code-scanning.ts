/**
 * Reviews the open GitHub code-scanning alerts of the branch you are on and rejects each one
 * explicitly (a branch with no analysis yet has none, so a branch carrying a fix is never blocked by
 * the default branch's still-open alert). LOCAL ONLY: it reads them with the developer's own `gh` login (see
 * {@link file://../scripts/code-scanning-alerts.mjs}) and does nothing in CI.
 *
 * ## Policy
 *
 * An alert is judged by WHERE it is, not by its severity or level:
 *
 * - **Development-only code** (tests, scripts that are not published, docs, examples, benchmarks,
 *   `.github/`, `*.config.*`): the alert cannot reach a user, so it is rejected with a standing
 *   exception -- the same reason every time -- recorded in
 *   `.repo-contract/exceptions/code-scanning.json`. The check scaffolds that record, fully written,
 *   for you; only the one `exceptionType` `dev-only-not-shipped` is accepted.
 * - **Anything that builds, runs or ships** (`src/`, `bin/`, published package files, ...): the alert
 *   must be FIXED. There is no exception for it; the check fails until GitHub no longer reports it.
 *
 * ## The registry is git-ignored on purpose
 *
 * `.repo-contract/exceptions/code-scanning.json` lists weaknesses in the code, so it is never
 * committed and every clone builds its own. Add it to `.gitignore` (`init` does).
 *
 * Example record (id is `code-scanning:<rule>@<path>`; one record covers every alert of a rule in a file):
 *
 * ```json
 * {
 *   "exceptions": [
 *     {
 *       "id": "code-scanning:js/bad-tag-filter@test/build/banner.test.ts",
 *       "version": 1,
 *       "justification": "Development-only code (tests, scripts, docs, CI configuration) is never built, run by users or published, so a finding in it cannot reach anyone.",
 *       "alternatives": "Rewrite the flagged code to satisfy the rule.",
 *       "remediation": "None needed while the code stays development-only.",
 *       "method": "independent-human-review",
 *       "exceptionType": "dev-only-not-shipped",
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
  SECURITY_EXCEPTION_FIELD_KEYS,
  evaluateFindingVerdict,
  isValidNonEmptyStringField,
  loadAndReconcileExceptionRegistry,
  validateExceptionRegistry,
  validateSecurityExceptionFields,
} from "./exception-record.js"
import type { ExceptionMethod, ExceptionRegistrySchema, ExceptionType } from "./exception-record.js"
import { packageRoot, parseToolEnvelope } from "./shared.js"

const scriptPath = path.join(packageRoot, "scripts", "code-scanning-alerts.mjs")
const REGISTRY_RELATIVE_PATH = ".repo-contract/exceptions/code-scanning.json"
const MAX_LISTED = 20

/** The one reason recorded for every development-only alert, so the standing decision reads identically. */
const DEV_JUSTIFICATION =
  "Development-only code (tests, scripts, docs, CI configuration) is never built, run by users or published, so a finding in it cannot reach anyone."
const DEV_ALTERNATIVES = "Rewrite the flagged code to satisfy the rule."
const DEV_REMEDIATION = "None needed while the code stays development-only."

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

interface CodeScanningRecord {
  readonly id: string
  readonly version: 1
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
    version: 1,
    justification: DEV_JUSTIFICATION,
    alternatives: DEV_ALTERNATIVES,
    remediation: DEV_REMEDIATION,
    method: "independent-human-review",
    exceptionType: "dev-only-not-shipped",
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

const REQUIREMENTS = ["justification", "alternatives", "remediation", "method", "exceptionType"]
const POLICY: ExceptionPolicyConfig = {
  "code-scanning": {
    rules: { dev: { mode: "exception", requirements: [...REQUIREMENTS] } },
  },
}

/** Steps for the one situation each failure kind means; always local, since this check never runs in CI. */
function guidance(kind: string | undefined, message: string | undefined): string {
  const steps =
    kind === "gh-not-installed"
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
        return { outcome: "pass", rationale: `Code scanning review skipped: ${skipped}.` }
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
