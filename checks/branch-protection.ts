/**
 * `BranchProtection`: the default branch of the repository `origin` points at cannot be merged into
 * without a green `contract` job, nor without a green `required` job where the package's CI has one.
 *
 * Reads: the repository's active GitHub rulesets through the `gh` CLI, by way of
 * `scripts/check-branch-protection.mjs`. Locally that is a person's `gh auth login`; in Actions it
 * is `GH_TOKEN` or `GITHUB_TOKEN`. Also the workflows under `.github/workflows`, for one that defines
 * both a `contract` and a `required` job (the aggregate the scaffolded `contract.yml` has).
 *
 * Fails when the default branch lacks deletion protection, force-push protection, or a pull-request
 * rule. Fails when it lacks a required-status-checks rule, or that rule lacks the `contract`
 * context. Fails when such a workflow exists and the rule lacks the `required` context. Fails when
 * that rule is not strict (the branch must be up to date before it merges). Fails when review
 * threads need not be resolved. Never warns on a finding.
 *
 * Exceptions: none for a finding; `internal-package-contract init --github` writes the ruleset. One
 * degradation, `BranchProtection:gh-unavailable`: `gh` missing or signed out, an `origin` that is
 * not a GitHub URL, or a failed API call. It warns locally. Under `--strict`, the CI default, it
 * fails unless `.repo-contract/exceptions/environment.json` holds a complete record. The record id
 * is `environment:BranchProtection:gh-unavailable`.
 *
 * Runs in the consumer `contract` job, in both git hooks, and in IPC's own self-contract.
 *
 * Limit: a ruleset whose details cannot be read is skipped. The branch then reads as unprotected
 * rather than as a degradation.
 */
import path from "node:path"
import type { CheckDefinitionConfig, PolicyResult } from "repo-contract"
import {
  REQUIRED_AGGREGATE_CONTEXT,
  REQUIRED_STATUS_CHECK_CONTEXT,
} from "../scripts/github-repo.mjs"
import { degraded } from "./environment-exceptions.js"
import { packageRoot, parseToolEnvelope } from "./shared.js"

const branchProtectionScript = path.join(packageRoot, "scripts", "check-branch-protection.mjs")

interface BranchProtectionStatus {
  readonly owner: string
  readonly repo: string
  readonly defaultBranch: string
  readonly hasDeletion: boolean
  readonly hasNonFastForward: boolean
  readonly hasPullRequest: boolean
  readonly hasRequiredStatusChecks: boolean
  readonly requiredChecks: readonly string[]
  /** Whether a branch must be up to date with its base before it merges, so the checks ran on what is merged. */
  readonly strictStatusChecks: boolean
  readonly requiresThreadResolution: boolean
  /** The workflow that defines both `contract` and the aggregate `required` job, or null when none does. */
  readonly aggregateWorkflow?: string | null
}

type ToolResult =
  ({ readonly ok: true } & BranchProtectionStatus) | { readonly ok: false; readonly error: string }

/**
 * Builds the check.
 * @param requiredCheck - The status-check context the default branch must require; `"contract"` for every consumer (the scaffolded workflow's job id), overridden only by a repository whose own CI job is named differently.
 * @returns The check definition.
 */
export function createBranchProtection(
  requiredCheck: string = REQUIRED_STATUS_CHECK_CONTEXT,
): CheckDefinitionConfig {
  return {
    run: ["node", branchProtectionScript],
    output: { format: "json" },
    policy: async ({ result }): Promise<PolicyResult> => {
      const envelope = parseToolEnvelope<ToolResult>(result, "gh", "Branch protection: gh")
      if (!envelope.ok) return envelope.result

      const status = envelope.value
      if (!status.ok) {
        return degraded({
          check: "BranchProtection",
          code: "gh-unavailable",
          rationale: `Branch protection: ${status.error}`,
        })
      }

      const missing: string[] = []
      if (!status.hasDeletion) missing.push("deletion protection")
      if (!status.hasPullRequest) missing.push("a pull-request-required rule")
      if (!status.hasNonFastForward) missing.push("force-push protection")
      if (!status.hasRequiredStatusChecks) {
        missing.push("a required-status-checks rule")
      } else {
        if (!status.requiredChecks.includes(requiredCheck)) {
          missing.push(`the "${requiredCheck}" check among its required status checks`)
        }
        if (
          status.aggregateWorkflow &&
          !status.requiredChecks.includes(REQUIRED_AGGREGATE_CONTEXT)
        ) {
          missing.push(
            `the "${REQUIRED_AGGREGATE_CONTEXT}" check among its required status checks (${status.aggregateWorkflow} defines that job)`,
          )
        }
        if (!status.strictStatusChecks) {
          missing.push("strict status checks (a branch up to date with its base before it merges)")
        }
      }
      if (!status.requiresThreadResolution) missing.push("required review-thread resolution")

      if (missing.length > 0) {
        return {
          outcome: "fail",
          rationale: `Branch protection: ${status.owner}/${status.repo}'s default branch (${status.defaultBranch}) is missing ${missing.join(" and ")}. Run \`internal-package-contract init\` to configure it.`,
        }
      }

      const checks = status.aggregateWorkflow
        ? `"${requiredCheck}" and "${REQUIRED_AGGREGATE_CONTEXT}" checks`
        : `"${requiredCheck}" check`
      return {
        outcome: "pass",
        rationale: `Branch protection: ${status.owner}/${status.repo}'s default branch (${status.defaultBranch}) blocks deletion, force-pushes, and merging without a PR, and requires the ${checks} (strict) and resolved review threads.`,
      }
    },
  }
}

export const branchProtection: CheckDefinitionConfig = createBranchProtection()
