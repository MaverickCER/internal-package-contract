/**
 * AI code review via the real, installed CodeRabbit CLI (`coderabbit review --agent
 * --uncommitted`), with every finding gated on a complete, finding-specific waiver in the
 * consumer's own `.repo-contract/exceptions/coderabbit.json` -- a generic recreation of
 * repo-contract's own `coderabbitai` check (`checks/coderabbitai.ts` +
 * `scripts/coderabbitai/{review,evidence-types,policy-config,registry}.ts` in that repo, designed
 * in its specs/decisions/0014-coderabbit-as-a-surfaced-check.md on top of
 * specs/decisions/0013-reusable-exception-policy-helper.md), run through the bundled
 * `scripts/coderabbitai/review.ts` (see its own doc comment for the CLI contract it parses).
 *
 * The whole point of ADR 0014, and the reason this is a real check rather than a git-hook shell
 * step: **its own non-execution is recorded**. A local skip surfaces the same visible `warn` on
 * every single run instead of a silent pass, so "CodeRabbit never looked at this" is never
 * indistinguishable from "CodeRabbit found nothing":
 * - `not-applicable` (`CI` is set) -- review is delegated to CodeRabbit's own GitHub App, which
 *   posts findings on the pull request. `warn`, naming `coderabbit-github-app`.
 * - `unavailable` (`cli-not-installed`, or a detached `HEAD` a diff-based review can't anchor) --
 *   `warn`, exactly like `SecuritySocket`'s own not-authenticated case and `Accessibility`'s
 *   no-system-Chrome case. This check cannot distinguish "genuinely clean" from "never ran," so it
 *   never fails closed on absence alone.
 * - `error` (the CLI ran but produced a malformed event stream, timed out, or failed) -- `fail`,
 *   the same fail-closed stance `Mutation` takes for a malformed Stryker report.
 *
 * The `coderabbit` CLI is deliberately NOT a dependency of this package (unlike `pa11y`,
 * `@socketsecurity/cli`, Stryker, ...): it is a credentialed, network-bound developer tool
 * installed once per machine (https://docs.coderabbit.ai/cli), not an npm executable a contract can
 * ship. That is precisely why its absence is a first-class, recorded `warn` state here.
 *
 * ## Exception policy
 *
 * Every finding requires a complete, finding-specific record regardless of severity -- there is no
 * severity tier the way Socket alerts have one, because a CodeRabbit finding is an AI opinion, not
 * a deterministic tool result (`scripts/coderabbitai/policy-config.ts`). Required fields:
 * `justification`, `remediation`, `method`, `exceptionType`. `method` may only ever be
 * `"independent-human-review"`, and `exceptionType` may never be `"validated-false-positive"` --
 * there is no more-authoritative tool to mechanically re-run against an AI-generated finding, so a
 * false-positive claim has nothing to rest on (`scripts/coderabbitai/registry.ts`).
 *
 * Example record:
 *
 * ```json
 * {
 *   "exceptions": [
 *     {
 *       "id": "coderabbit:src/build/resolve.ts:major:7c1e9a4f2b03",
 *       "version": 1,
 *       "justification": "The suggested early return would skip the cache write this function exists to perform; verified against the \"memoizes\" test.",
 *       "alternatives": "",
 *       "remediation": "None planned -- the current shape is intentional and documented.",
 *       "method": "independent-human-review",
 *       "exceptionType": "accepted-risk",
 *       "file": "src/build/resolve.ts",
 *       "severity": "major",
 *       "summary": "Consider returning early when the cache already holds a value."
 *     }
 *   ]
 * }
 * ```
 *
 * The registry is reconciled and rewritten every reviewed run (like `SecuritySocket`, unlike
 * `mutation.ts`'s deliberately non-reconciling model): a blank stub is scaffolded for a
 * newly-raised finding, and a record matching no finding this run is reported stale. A finding's id
 * hashes the CLI's own summary prose, so a re-review whose wording changed deliberately churns the
 * id -- that is exactly when a human should re-confirm the waiver still applies. `mutation.ts`'s
 * opt-out reasoning (Stryker's per-run non-determinism) does not apply: a CodeRabbit review of an
 * unchanged diff is a normal per-run reconciliation case.
 *
 * `checks/exception-record.ts` owns the shared `id`/`version`/`justification` core, the
 * security-family authoring fields, registry-shape validation, and the single
 * `reconcileAndPersistExceptionRegistry` reconcile -> validate -> persist entrypoint this check's
 * own wrapper script calls; `evaluateExceptionRecord`/`validateExceptionPolicyConfig`
 * (`repo-contract/helpers`) decide whether a matched record satisfies policy.
 *
 * Not `isolated`: the subprocess it spawns is a single network-bound CLI waiting on a remote
 * review, not a CPU-saturating worker pool, so it contends with nothing -- matching repo-contract's
 * own plain `coderabbitai,` registration.
 */
import path from "node:path"
import type { CheckDefinitionConfig, PolicyResult } from "repo-contract"
import type { ExceptionClassification } from "repo-contract/helpers"
import { validateExceptionPolicyConfig } from "repo-contract/helpers"
import { evaluateFindingVerdict, validateExceptionRegistry } from "./exception-record.js"
import { abnormalTermination, combinedOutput, packageRoot } from "./shared.js"
import type {
  CoderabbitEvidence,
  CoderabbitExceptionRecord,
  NormalizedFinding,
} from "../scripts/coderabbitai/evidence-types.js"
import {
  CODERABBIT_GLOBAL_DEFAULT_POLICY,
  CODERABBIT_POLICY,
  VALID_CODERABBIT_REQUIREMENTS,
} from "../scripts/coderabbitai/policy-config.js"
import { CODERABBIT_EXCEPTION_SCHEMA } from "../scripts/coderabbitai/registry.js"

const reviewScript = path.join(packageRoot, "scripts", "coderabbitai", "review.ts")

/**
 * Evaluates one finding against `CODERABBIT_POLICY`, classified purely on its `severity`. The
 * `record === undefined -> "unmatched"` short-circuit and the flat string-field accessor both come
 * from `checks/exception-record.ts`'s shared {@link evaluateFindingVerdict}, exactly as
 * `SecuritySocket`'s own `evaluateAlert` does.
 * @param finding - The finding.
 * @param record - The reconciled live record for it, or `undefined` if the bijection broke.
 * @returns The verdict and any still-missing required fields.
 * @internal Exported for direct unit coverage.
 */
export function evaluateFinding(
  finding: NormalizedFinding,
  record: CoderabbitExceptionRecord | undefined,
): {
  readonly verdict: "forbidden" | "insufficient" | "permitted" | "unmatched"
  readonly missing: readonly string[]
} {
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

/**
 * Evaluates this check's own emitted evidence -- a pure evidence->verdict function.
 * `not-applicable` (CI, review delegated to the GitHub App) / `unavailable` is a `warn`, always
 * visibly recorded. `error` fails closed. A malformed/unreconcilable registry (`registryError`)
 * fails regardless of status. A `reviewed` run: any `forbidden` / `insufficient` / `unmatched`
 * verdict or stale record fails, listed individually.
 * @param input - Wraps the evidence to evaluate.
 * @param input.evidence - The `CoderabbitEvidence` emitted by `scripts/coderabbitai/review.ts`.
 * @returns The check's `PolicyResult`.
 * @internal Exported for direct unit coverage -- the whole verdict surface is reachable from a
 * constructed evidence value, with no real CodeRabbit CLI ever spawned.
 */
export function evaluateCoderabbitPolicy(input: {
  readonly evidence: CoderabbitEvidence
}): PolicyResult {
  const { evidence } = input

  if (evidence.registryError !== undefined) {
    return {
      outcome: "fail",
      rationale: [
        `${evidence.registryPath} failed to load or reconcile and was left unchanged:`,
        ...evidence.registryError.map((e) => `- ${e}`),
      ].join("\n"),
    }
  }

  const configErrors = validateExceptionPolicyConfig(
    CODERABBIT_POLICY,
    VALID_CODERABBIT_REQUIREMENTS,
  )
  if (configErrors.length > 0) {
    return {
      outcome: "fail",
      rationale: ["CODERABBIT_POLICY is misconfigured:", ...configErrors.map((e) => `- ${e}`)].join(
        "\n",
      ),
    }
  }

  if (evidence.status === "not-applicable") {
    return {
      outcome: "warn",
      rationale: `CodeRabbit did not run (${evidence.reason}) -- findings were not evaluated. Expected in CI, where review is delegated to the ${evidence.expectedProvider}.${unreconciledNote(evidence.existingRecordCount, evidence.registryPath)}`,
    }
  }

  if (evidence.status === "unavailable") {
    return {
      outcome: "warn",
      rationale: `CodeRabbit did not run (${evidence.reason}) -- findings were not evaluated. Install the CodeRabbit CLI (https://docs.coderabbit.ai/cli) and run from a real branch to enable real enforcement.${unreconciledNote(evidence.existingRecordCount, evidence.registryPath)}`,
    }
  }

  if (evidence.status === "error") {
    return { outcome: "fail", rationale: `CodeRabbit review failed: ${evidence.message}` }
  }

  // Independent re-validation of what the wrapper script actually wrote: the policy never trusts
  // its own subprocess's reconciled records without re-checking them against the same registry
  // schema the script loaded them with.
  const activeRecords = Object.values(evidence.activeExceptions)
  const revalidated = validateExceptionRegistry(
    [...activeRecords, ...evidence.staleExceptions],
    CODERABBIT_EXCEPTION_SCHEMA,
  )
  if (!revalidated.ok) {
    return {
      outcome: "fail",
      rationale: [
        "CodeRabbit evidence failed independent registry validation:",
        ...revalidated.errors.map((e) => `- ${e}`),
      ].join("\n"),
    }
  }

  const bijectionErrors = findBijectionErrors(evidence.findings, evidence.activeExceptions)
  if (bijectionErrors.length > 0) {
    return {
      outcome: "fail",
      rationale: [
        "CodeRabbit evidence broke the findings <-> activeExceptions bijection:",
        ...bijectionErrors.map((e) => `- ${e}`),
      ].join("\n"),
    }
  }

  const staleLines = evidence.staleExceptions.map(
    (record) =>
      `- Stale exception in ${evidence.registryPath}: ${JSON.stringify(record.id)} -- CodeRabbit no longer raises this finding (or its wording changed); delete this entry.`,
  )

  const determinants = evidence.findings.map((finding) => ({
    finding,
    ...evaluateFinding(finding, evidence.activeExceptions[finding.id]),
  }))
  const offenders = determinants.filter((d) => d.verdict !== "permitted")

  if (offenders.length === 0 && staleLines.length === 0) {
    const suffix =
      evidence.scaffoldedIds.length > 0
        ? ` (${String(evidence.scaffoldedIds.length)} new record(s) scaffolded blank in ${evidence.registryPath})`
        : ""
    return {
      outcome: "pass",
      rationale: `${String(evidence.findings.length)} CodeRabbit finding(s) evaluated: all permitted by a complete exception record.${suffix}`,
    }
  }

  const offenderLines = offenders.map((d) => {
    const detail =
      d.verdict === "forbidden"
        ? "forbidden by policy"
        : d.verdict === "unmatched"
          ? "no reconciled exception record (registry integrity failure)"
          : `exception incomplete (missing: ${d.missing.join(", ")})`
    return `- ${d.finding.file} [${d.finding.severity}]: ${detail} -- ${d.finding.summary}`
  })

  return {
    outcome: "fail",
    rationale: [
      `${String(offenders.length + evidence.staleExceptions.length)} CodeRabbit finding(s) or stale record(s) need attention:`,
      ...offenderLines,
      ...staleLines,
    ].join("\n"),
  }
}

/** The " N exception record(s) ... were validated but not reconciled" suffix both no-review warn states share -- empty when the registry holds nothing. */
function unreconciledNote(existingRecordCount: number, registryPath: string): string {
  return existingRecordCount > 0
    ? ` ${String(existingRecordCount)} exception record(s) in ${registryPath} were validated but not reconciled (no review ran).`
    : ""
}

/**
 * Every way the wrapper script's own `findings` <-> `activeExceptions` correspondence can be
 * broken: a duplicate finding id, a finding with no active record, or an active record matching no
 * finding. All three mean the reconciliation this policy is about to read is not trustworthy, so
 * none of them is tolerated.
 * @internal Exported for direct unit coverage -- each of the three branches is independently
 * reachable only from a hand-built, deliberately-inconsistent evidence value.
 */
export function findBijectionErrors(
  findings: readonly NormalizedFinding[],
  activeExceptions: Readonly<Record<string, CoderabbitExceptionRecord>>,
): readonly string[] {
  const findingIds = findings.map((finding) => finding.id)
  const activeIds = new Set(Object.keys(activeExceptions))
  const errors: string[] = []
  if (new Set(findingIds).size !== findingIds.length) {
    errors.push("evidence.findings contains duplicate ids.")
  }
  for (const id of new Set(findingIds)) {
    if (!activeIds.has(id)) {
      errors.push(`finding ${JSON.stringify(id)} has no active exception record.`)
    }
  }
  for (const id of activeIds) {
    if (!findingIds.includes(id)) {
      errors.push(`active exception ${JSON.stringify(id)} matches no finding.`)
    }
  }
  return errors
}

/** @returns the `CodeRabbit` check. */
export function coderabbitai(): CheckDefinitionConfig {
  return {
    run: ["tsx", reviewScript],
    output: { format: "json" },
    policy: ({ result }): PolicyResult => {
      // The wrapper script always exits 0 having printed *some* well-formed evidence, so a
      // non-`completed` status or unparseable stdout means the script itself never ran (no `tsx` on
      // PATH) or crashed -- a real breakage of this package's own tooling, not a CodeRabbit state.
      const terminated = abnormalTermination(result, "tsx")
      if (terminated) return { outcome: "fail", rationale: terminated }

      if (!result.output?.success) {
        const printed = combinedOutput(result)
        const detail = result.output?.error ? ` ${result.output.error}` : ""
        return {
          outcome: "fail",
          rationale: `CodeRabbit: scripts/coderabbitai/review.ts output could not be parsed as JSON.${detail}${printed ? `\n${printed}` : ""}`,
        }
      }

      return evaluateCoderabbitPolicy({ evidence: result.output.value as CoderabbitEvidence })
    },
  }
}
