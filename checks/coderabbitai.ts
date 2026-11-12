/**
 * `CodeRabbit`: an AI review of the change. Its findings are advice, and its non-execution is
 * recorded.
 *
 * Reads: `CI`; git's answer on a detached `HEAD`, uncommitted edits and `origin/main`; and
 * `.repo-contract/exceptions/coderabbit.json`. Then the event stream of `coderabbit review
 * --agent`, with `--uncommitted`, or `--committed --base <ref>` on a clean tree. All through
 * `scripts/coderabbitai/review.ts`. The `coderabbit` CLI is not a dependency of this package; it is
 * installed per machine.
 *
 * Fails only when the registry cannot be loaded, reconciled or re-validated. Fails when the
 * evidence's findings and records do not correspond one to one, or when the script itself crashed.
 * Everything else warns: an incomplete record, a stale record, a review that errored, a review that
 * did not run. A review of the same diff is worded differently each time, so a finding never stops
 * a commit.
 *
 * Exceptions: id `coderabbit:<file>:<severity>:<hash>` with `file`, `severity` and `summary`
 * fields, the security fields and the version 2 fields. A blank stub is written for a new finding
 * once a review ran. `exceptionType` may not be `validated-false-positive`, and `method` may not be
 * `mechanical-reverification`: no tool can re-run an AI finding. Two degradations exist.
 * `CodeRabbit:not-applicable`: `CI` is set, and the GitHub App reviews the pull request.
 * `CodeRabbit:unavailable`: no usable CLI. Each warns locally. Under `--strict`, the CI default,
 * each fails unless `.repo-contract/exceptions/environment.json` holds a complete record. The
 * record id is `environment:CodeRabbit:<code>`.
 *
 * Runs in the consumer `contract` job and in both git hooks. It is declared late among the readers
 * and not isolated: it waits on the network, not on CPU. IPC's own self-contract leaves it out: the
 * review bot is configured per consumer repository.
 *
 * Example record:
 *
 * ```json
 * {
 *   "exceptions": [
 *     {
 *       "id": "coderabbit:src/build/resolve.ts:major:7c1e9a4f2b03",
 *       "version": 2,
 *       "justification": "The suggested early return would skip the cache write this function exists to perform; verified against the \"memoizes\" test.",
 *       "alternatives": "Restructure the function so the cache write is unconditional.",
 *       "remediation": "None planned; the current shape is intentional and documented.",
 *       "method": "independent-human-review",
 *       "exceptionType": "accepted-risk",
 *       "file": "src/build/resolve.ts",
 *       "severity": "major",
 *       "summary": "Consider returning early when the cache already holds a value.",
 *       "ruleBroken": "A CodeRabbit finding is adopted or its rejection is recorded.",
 *       "attempted": "The early return was tried; the memoization test failed.",
 *       "constraint": "The cache write must happen on every call that computes a value.",
 *       "whyPreferable": "Keeping the write unconditional keeps the memoization test meaningful.",
 *       "residualRisk": "None; the reviewer's concern was readability, not behaviour.",
 *       "revisitWhen": "The function is rewritten or the cache is removed.",
 *       "expires": ""
 *     }
 *   ]
 * }
 * ```
 */
import path from "node:path"
import type { CheckDefinitionConfig, PolicyResult } from "repo-contract"
import type { ExceptionClassification } from "repo-contract/helpers"
import { validateExceptionPolicyConfig } from "repo-contract/helpers"
import { degraded } from "./environment-exceptions.js"
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
  // Stryker disable all -- equivalent mutants. `CODERABBIT_GLOBAL_DEFAULT_POLICY` is deliberately
  // byte-identical to `CODERABBIT_POLICY.coderabbit.default` (see
  // `scripts/coderabbitai/policy-config.ts`: one group, one group-level default, the same four
  // requirements), so mutating `"coderabbit"` to `""` -- or the whole classification to `{}` --
  // only makes `resolveExceptionPolicy` miss the group and fall through to that identical global
  // default. Every input then resolves to exactly the same policy, the same verdict and the same
  // `missing` list, so no test could ever observe a difference.
  const classifications: readonly [ExceptionClassification, ...ExceptionClassification[]] = [
    { group: "coderabbit", category: finding.severity },
  ]
  // Stryker restore all
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
 * verdict or stale record warns (CodeRabbit is advisory), listed individually; an `error` review warns too.
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
  // Stryker disable all -- CODERABBIT_POLICY/VALID_CODERABBIT_REQUIREMENTS are fixed, valid module
  // constants (see `scripts/coderabbitai/policy-config.ts`); this defensive guard can never observe
  // a misconfigured policy under any real invocation of this function, since it never varies at
  // runtime. No test can hit it without literally breaking those constants. Kept as
  // defense-in-depth against a future editing mistake in CODERABBIT_POLICY itself -- exactly as
  // `SecuritySocket`'s and `SecurityDeps`' own identical guards are annotated.
  if (configErrors.length > 0) {
    return {
      outcome: "fail",
      rationale: ["CODERABBIT_POLICY is misconfigured:", ...configErrors.map((e) => `- ${e}`)].join(
        "\n",
      ),
    }
  }
  // Stryker restore all

  if (evidence.status === "not-applicable") {
    return {
      outcome: "warn",
      rationale: `CodeRabbit did not run (${evidence.reason}) -- findings were not evaluated. Expected in CI, where review is delegated to the ${evidence.expectedProvider}.${unreconciledNote(evidence.existingRecordCount, evidence.registryPath)}`,
    }
  }

  if (evidence.status === "unavailable") {
    const hint = {
      "cli-not-installed": "Install the CodeRabbit CLI (https://docs.coderabbit.ai/cli)",
      "git-context-unavailable":
        "Run it from a branch git can diff against its base (a checked-out branch with a remote)",
      "not-signed-in": "Sign in with the CodeRabbit CLI",
      "network-unreachable": "Check the network connection",
    }[evidence.reason]
    return {
      outcome: "warn",
      rationale: `CodeRabbit did not run (${evidence.reason}) -- findings were not evaluated. ${hint} to enable real enforcement.${unreconciledNote(evidence.existingRecordCount, evidence.registryPath)}`,
    }
  }

  // CodeRabbit is advisory: a review that cannot be read leaves the run without suggestions, which is
  // visible, not a failure of the change under review.
  if (evidence.status === "error") {
    return { outcome: "warn", rationale: `CodeRabbit review failed: ${evidence.message}` }
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
    // Both leading branches are structurally unreachable *from here*, unlike in
    // `SecuritySocket`'s identically-shaped `evaluateFinalVerdict` this line format was ported
    // alongside: `CODERABBIT_POLICY` declares no `{ mode: "forbidden" }` tier at all (one group,
    // every severity in `"exception"` mode), so `evaluateFinding` can never return `"forbidden"`
    // here; and `findBijectionErrors` above has already failed the whole run for any finding whose
    // id is absent from `evidence.activeExceptions`, so `evaluateFindingVerdict`'s
    // `record === undefined -> "unmatched"` short-circuit can never be observed past that guard
    // either (both verdicts *are* independently covered on `evaluateFinding`/`findBijectionErrors`
    // themselves). Kept verbatim as defense-in-depth: a future `forbidden` severity tier, or a
    // relaxed bijection guard, must still render a correct offender line rather than silently
    // mislabel one as "exception incomplete".
    // Stryker disable all -- unreachable defensive branches, see comment above.
    const detail =
      d.verdict === "forbidden"
        ? "forbidden by policy"
        : d.verdict === "unmatched"
          ? "no reconciled exception record (registry integrity failure)"
          : // Stryker restore all
            `exception incomplete (missing: ${d.missing.join(", ")})`
    return `- ${d.finding.file} [${d.finding.severity}]: ${detail} -- ${d.finding.summary}`
  })

  // Advisory: CodeRabbit's findings are suggestions, adopted where they improve the code. A review of the same
  // diff words them differently on every run, so no record can be relied on to match the next one; they are
  // reported, never a reason to stop a commit.
  return {
    outcome: "warn",
    rationale: [
      `${String(offenders.length + evidence.staleExceptions.length)} CodeRabbit suggestion(s) to consider (advisory: adopt one where it improves the code; a record only documents why one was not taken):`,
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
    policy: async ({ result }): Promise<PolicyResult> => {
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

      const evidence = result.output.value as CoderabbitEvidence
      const verdict = evaluateCoderabbitPolicy({ evidence })
      // "Did not run" is a degradation, not a verdict: it is recorded, and accepted only by a record
      // in `.repo-contract/exceptions/environment.json` (`environment:CodeRabbit:<status>`).
      if (evidence.status === "not-applicable" || evidence.status === "unavailable") {
        return degraded({
          check: "CodeRabbit",
          code: evidence.status,
          rationale: verdict.rationale,
        })
      }
      return verdict
    },
  }
}
