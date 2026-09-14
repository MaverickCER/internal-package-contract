/**
 * Governs every `eslint-disable`/`@ts-ignore`/`@ts-expect-error`/`@ts-nocheck`/`Stryker disable`
 * suppression-directive comment across this package's own source against a reviewable, file-based
 * exception registry (`.repo-contract/exceptions/suppressions.json`) -- never a hardcoded
 * in-source allowlist, matching every other exception-bearing check in this package
 * (`SecurityDeps`, `SecuritySocket`, and the shared core in `./exception-record.js`).
 *
 * Scanning itself (`scripts/check-suppressions.mjs`, ported from repo-contract's own
 * `scripts/suppression-governance/{find-source-files,canonicalize-comment,recognizers,
 * discover-suppressions}.ts` -- pure logic, no repo-contract-specific dependencies) uses the
 * TypeScript compiler's own scanner rather than shelling out to ESLint, so a suppression that
 * caused ESLint to be bypassed is still audited. This file owns only reconciling those raw
 * findings against the registry and deciding pass/fail -- the same discovery/policy split every
 * self-hosted check in this package and in repo-contract itself uses.
 *
 * `category`/`verificationMethod` reuse repo-contract's own closed taxonomies verbatim (see
 * SUPPRESSION_CATEGORIES/VERIFICATION_METHODS below) rather than inventing a parallel one -- both
 * packages govern the identical suppression domains (eslint/typescript/stryker), so one shared
 * mental model serves both.
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
  buildRegistrySchema,
  evaluateFindingVerdict,
  isValidNonEmptyStringField,
  reconcileRegistry,
  summarizeReconciliation,
} from "./exception-record.js"
import type { ExceptionRegistrySchema } from "./exception-record.js"
import { abnormalTermination, packageRoot } from "./shared.js"

const REGISTRY_RELATIVE_PATH = ".repo-contract/exceptions/suppressions.json"
const scriptPath = path.join(packageRoot, "scripts", "check-suppressions.mjs")

/** Ported verbatim from repo-contract's own `scripts/suppression-governance/evidence-types.ts` -- see that file for each member's full definition and the boundary tests between easily-conflated pairs. `""` is the deliberate "not yet classified" sentinel a freshly-scaffolded stub starts with. */
const SUPPRESSION_CATEGORIES = [
  "",
  "equivalent-mutant",
  "unreachable-invariant",
  "platform-limitation",
  "tooling-limit",
  "rule-not-applicable",
  "intentional-deviation",
] as const
type SuppressionCategory = (typeof SUPPRESSION_CATEGORIES)[number]

/** Ported verbatim from repo-contract's own `scripts/suppression-governance/evidence-types.ts` -- see that file for each member's full definition and the anti-gaming rule governing all of them. */
const VERIFICATION_METHODS = [
  "",
  "mutation-run",
  "existing-test-suite",
  "differential-testing",
  "static-reasoning",
  "untestable",
] as const
type VerificationMethod = (typeof VERIFICATION_METHODS)[number]

interface SuppressionFinding {
  readonly id: string
  readonly domain: string
  readonly rule: readonly string[]
  readonly file: string
  readonly line: number
  readonly content: string
  readonly reason: string
}

interface DiscoveryReport {
  readonly ok: boolean
  readonly findings?: readonly SuppressionFinding[]
  readonly error?: string
}

/** One `.repo-contract/exceptions/suppressions.json` record. */
interface SuppressionExceptionRecord {
  readonly id: string
  readonly version: 1
  readonly justification: string
  readonly category: SuppressionCategory
  readonly verificationMethod: VerificationMethod
  readonly domain: string
  readonly file: string
  readonly line: number
  readonly rule: readonly string[]
}

function createSuppressionStub(
  finding: SuppressionFinding,
  id: string,
): SuppressionExceptionRecord {
  return {
    id,
    version: 1,
    justification: "",
    category: "",
    verificationMethod: "",
    domain: finding.domain,
    file: finding.file,
    line: finding.line,
    rule: [...finding.rule],
  }
}

const SUPPRESSION_EXCEPTION_SCHEMA: ExceptionRegistrySchema<SuppressionExceptionRecord> = {
  namespace: "suppression:",
  metadataKeys: ["category", "verificationMethod", "domain", "file", "line", "rule"],
  validateRecord(core: ExceptionRecordCore, raw, index, errors) {
    const at = `exceptions[${String(index)}]`
    const { category, verificationMethod, domain, file, line, rule } = raw

    const categoryValid =
      typeof category === "string" &&
      (SUPPRESSION_CATEGORIES as readonly string[]).includes(category)
    if (!categoryValid) {
      errors.push(
        `${at}.category must be one of ${SUPPRESSION_CATEGORIES.map((c) => JSON.stringify(c)).join(", ")} (got ${JSON.stringify(category)}).`,
      )
    }

    const verificationMethodValid =
      typeof verificationMethod === "string" &&
      (VERIFICATION_METHODS as readonly string[]).includes(verificationMethod)
    if (!verificationMethodValid) {
      errors.push(
        `${at}.verificationMethod must be one of ${VERIFICATION_METHODS.map((m) => JSON.stringify(m)).join(", ")} (got ${JSON.stringify(verificationMethod)}).`,
      )
    }

    const domainValid = isValidNonEmptyStringField(domain, `${at}.domain`, errors)
    const fileValid = isValidNonEmptyStringField(file, `${at}.file`, errors)
    const lineValid = typeof line === "number" && Number.isInteger(line) && line > 0
    if (!lineValid)
      errors.push(`${at}.line must be a positive integer (got ${JSON.stringify(line)}).`)
    const ruleValid =
      Array.isArray(rule) &&
      rule.length > 0 &&
      rule.every((r) => typeof r === "string" && r.length > 0)
    if (!ruleValid) errors.push(`${at}.rule must be a non-empty array of non-empty strings.`)

    if (
      !categoryValid ||
      !verificationMethodValid ||
      !domainValid ||
      !fileValid ||
      !lineValid ||
      !ruleValid
    ) {
      return undefined
    }

    const identity = { domain, file, line: line as number, rule: rule as string[] }
    const derived = `suppression:${identity.domain}:${identity.rule.join(",")}:${identity.file}:${String(identity.line)}`
    if (derived !== core.id) {
      errors.push(
        `${at}.id ${JSON.stringify(core.id)} does not match the id derived from its own domain/rule/file/line (${JSON.stringify(derived)}).`,
      )
      return undefined
    }

    return {
      id: core.id,
      version: 1,
      justification: core.justification,
      category: category as SuppressionCategory,
      verificationMethod: verificationMethod as VerificationMethod,
      ...identity,
    }
  },
}

/** No severity tiering, matching `SecurityDeps`'s own reasoning: a suppression comment is either justified through the registry or it isn't -- there is no category of suppression this package tolerates unexplained. */
const REQUIREMENTS = ["justification", "category", "verificationMethod"]
const SUPPRESSION_POLICY: ExceptionPolicyConfig = {
  suppression: { default: { mode: "exception", requirements: [...REQUIREMENTS] } },
}
const SUPPRESSION_GLOBAL_DEFAULT_POLICY: ExceptionPolicy = {
  mode: "exception",
  requirements: [...REQUIREMENTS],
}
const VALID_SUPPRESSION_REQUIREMENTS = ["justification", "category", "verificationMethod"] as const

function evaluateFinding(
  finding: SuppressionFinding,
  record: SuppressionExceptionRecord | undefined,
) {
  const classifications: readonly [ExceptionClassification, ...ExceptionClassification[]] = [
    { group: "suppression", category: finding.domain },
  ]
  return evaluateFindingVerdict(
    record,
    classifications,
    SUPPRESSION_POLICY,
    SUPPRESSION_GLOBAL_DEFAULT_POLICY,
  )
}

const registrySchema = buildRegistrySchema(SUPPRESSION_EXCEPTION_SCHEMA)

export const suppressionGovernance: CheckDefinitionConfig = {
  run: ["node", scriptPath],
  output: { format: "json" },
  policy: async ({ result }): Promise<PolicyResult> => {
    const terminated = abnormalTermination(result, "check-suppressions")
    if (terminated) return { outcome: "fail", rationale: terminated }
    if (!result.output?.success) {
      return {
        outcome: "fail",
        rationale: "check-suppressions output could not be parsed as JSON.",
      }
    }
    const report = result.output.value as DiscoveryReport
    if (!report.ok) {
      return { outcome: "fail", rationale: report.error ?? "Suppression discovery failed." }
    }
    const findings = report.findings ?? []

    const registryPath = path.join(process.cwd(), REGISTRY_RELATIVE_PATH)
    const reconciled = await reconcileRegistry(
      registryPath,
      REGISTRY_RELATIVE_PATH,
      registrySchema,
      findings,
      createSuppressionStub,
      "SUPPRESSION_POLICY",
      SUPPRESSION_POLICY,
      VALID_SUPPRESSION_REQUIREMENTS,
    )
    if (!reconciled.ok) return reconciled.result

    return summarizeReconciliation(
      findings,
      reconciled.registry,
      REGISTRY_RELATIVE_PATH,
      "suppression(s)",
      evaluateFinding,
      (finding) =>
        `${finding.file}:${String(finding.line)} [${finding.domain}: ${finding.rule.join(",")}]`,
      () =>
        "its directive is gone; delete this entry (carry its justification to the new location first if the directive merely moved).",
    )
  },
}
