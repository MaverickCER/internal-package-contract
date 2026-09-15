/**
 * Promotes `coderabbit review --agent` from a local-only manual step into a real, always-declared
 * check -- its own non-execution (in CI, where review is delegated to the CodeRabbit GitHub App
 * instead, or locally when the CLI isn't installed / on a detached HEAD) is a `warn`, always
 * visibly recorded, never a silent skip. Matches repo-contract's own `coderabbitai` check.
 *
 * A real review finding requires a complete, reviewed exception record in
 * `.repo-contract/exceptions/coderabbit.json` -- the same registry model every exception-bearing
 * check in this package uses. Reuses the security-family field shape (`alternatives`/
 * `remediation`/`method`/`exceptionType`) from `./exception-record.js`, but excludes
 * `"validated-false-positive"`: unlike a deterministic scanner, there is no more-authoritative
 * tool to mechanically re-run against an AI-generated finding to confirm it "doesn't actually
 * apply" -- a CodeRabbit finding judged incorrect is still only ever dismissed via
 * `"accepted-risk"`/`"tooling-limitation"`/etc., backed by `method: "independent-human-review"`.
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
import { abnormalTermination, packageRoot } from "./shared.js"

const REGISTRY_RELATIVE_PATH = ".repo-contract/exceptions/coderabbit.json"
const scriptPath = path.join(packageRoot, "scripts", "check-coderabbitai.mjs")

/** Excludes `"validated-false-positive"` -- see this module's own doc comment for why. */
const CODERABBIT_EXCEPTION_TYPES = EXCEPTION_TYPES.filter(
  (type): type is Exclude<ExceptionType, "validated-false-positive"> =>
    type !== "validated-false-positive",
)

type Severity = "critical" | "major" | "minor" | "unknown"
const SEVERITY_VALUES = new Set(["critical", "major", "minor", "unknown"])

interface CoderabbitFinding {
  readonly id: string
  readonly file: string
  readonly severity: Severity
  readonly summary: string
}

type CliEnvelope =
  | { readonly status: "reviewed"; readonly findings?: readonly CoderabbitFinding[] }
  | {
      readonly status: "not-applicable"
      readonly reason: string
      readonly expectedProvider: string
    }
  | { readonly status: "unavailable"; readonly reason: string }
  | { readonly status: "error"; readonly message: string }

/** One `.repo-contract/exceptions/coderabbit.json` record. */
interface CoderabbitExceptionRecord {
  readonly id: string
  readonly version: 1
  readonly justification: string
  readonly alternatives: string
  readonly remediation: string
  readonly method: "" | ExceptionMethod
  readonly exceptionType: "" | ExceptionType
  readonly file: string
  readonly severity: Severity
  readonly summary: string
}

function createCoderabbitStub(finding: CoderabbitFinding, id: string): CoderabbitExceptionRecord {
  return {
    id,
    version: 1,
    justification: "",
    alternatives: "",
    remediation: "",
    method: "",
    exceptionType: "",
    file: finding.file,
    severity: finding.severity,
    summary: finding.summary,
  }
}

const CODERABBIT_EXCEPTION_SCHEMA: ExceptionRegistrySchema<CoderabbitExceptionRecord> = {
  namespace: "coderabbit:",
  metadataKeys: [...SECURITY_EXCEPTION_FIELD_KEYS, "file", "severity", "summary"],
  validateRecord(core: ExceptionRecordCore, raw, index, errors) {
    const at = `exceptions[${String(index)}]`
    const security = validateSecurityExceptionFields(raw, index, CODERABBIT_EXCEPTION_TYPES, errors)

    const { file, severity, summary } = raw
    const fileValid = isValidNonEmptyStringField(file, `${at}.file`, errors)
    const severityValid = typeof severity === "string" && SEVERITY_VALUES.has(severity)
    if (!severityValid) {
      errors.push(
        `${at}.severity must be one of ${[...SEVERITY_VALUES].map((s) => JSON.stringify(s)).join(", ")} (got ${JSON.stringify(severity)}).`,
      )
    }
    const summaryValid = isValidNonEmptyStringField(summary, `${at}.summary`, errors)

    if (security === undefined || !fileValid || !severityValid || !summaryValid) return undefined

    return {
      id: core.id,
      version: 1,
      justification: core.justification,
      ...security,
      file,
      severity: severity as Severity,
      summary,
    }
  },
}

const registrySchema = buildRegistrySchema(CODERABBIT_EXCEPTION_SCHEMA)

const REQUIREMENTS = ["justification", "alternatives", "remediation", "method", "exceptionType"]
const CODERABBIT_POLICY: ExceptionPolicyConfig = {
  coderabbit: { default: { mode: "exception", requirements: [...REQUIREMENTS] } },
}
const CODERABBIT_GLOBAL_DEFAULT_POLICY: ExceptionPolicy = {
  mode: "exception",
  requirements: [...REQUIREMENTS],
}
const VALID_CODERABBIT_REQUIREMENTS = [
  "justification",
  "alternatives",
  "remediation",
  "method",
  "exceptionType",
] as const

function evaluateFinding(
  finding: CoderabbitFinding,
  record: CoderabbitExceptionRecord | undefined,
) {
  const classifications: readonly [ExceptionClassification, ...ExceptionClassification[]] = [
    { group: "coderabbit", category: finding.severity },
  ]
  return evaluateFindingVerdict(
    record,
    classifications,
    CODERABBIT_POLICY,
    CODERABBIT_GLOBAL_DEFAULT_POLICY,
  )
}

export const coderabbitai: CheckDefinitionConfig = {
  run: ["node", scriptPath],
  output: { format: "json" },
  policy: async ({ result }): Promise<PolicyResult> => {
    const terminated = abnormalTermination(result, "check-coderabbitai")
    if (terminated) return { outcome: "fail", rationale: terminated }
    if (!result.output?.success) {
      return {
        outcome: "fail",
        rationale: "check-coderabbitai output could not be parsed as JSON.",
      }
    }
    const cli = result.output.value as CliEnvelope

    const registryPath = path.join(process.cwd(), REGISTRY_RELATIVE_PATH)

    if (cli.status === "not-applicable") {
      return {
        outcome: "warn",
        rationale: `coderabbitai did not run (${cli.reason}) -- findings were not evaluated. Expected in CI, where review is delegated to the ${cli.expectedProvider}.`,
      }
    }
    if (cli.status === "unavailable") {
      return {
        outcome: "warn",
        rationale: `coderabbitai did not run (${cli.reason}) -- findings were not evaluated. Install the CodeRabbit CLI (https://docs.coderabbit.ai/cli) and run from a real branch to enable real enforcement.`,
      }
    }
    if (cli.status === "error") {
      return { outcome: "fail", rationale: `coderabbitai review failed: ${cli.message}` }
    }

    const findings = cli.findings ?? []

    const reconciled = await reconcileRegistry(
      registryPath,
      REGISTRY_RELATIVE_PATH,
      registrySchema,
      findings,
      createCoderabbitStub,
      "CODERABBIT_POLICY",
      CODERABBIT_POLICY,
      VALID_CODERABBIT_REQUIREMENTS,
    )
    if (!reconciled.ok) return reconciled.result

    return summarizeReconciliation(
      findings,
      reconciled.registry,
      REGISTRY_RELATIVE_PATH,
      "CodeRabbit finding(s)",
      evaluateFinding,
      (finding) => `${finding.file} [${finding.severity}]`,
      () => "CodeRabbit no longer raises this finding (or its wording changed); delete this entry.",
    )
  },
}
