/**
 * Verifies the consumer's own default branch is protected against deletion
 * and against merging without a pull request, via a GitHub ruleset. Run
 * through the bundled `scripts/check-branch-protection.mjs`, which shells out
 * to the `gh` CLI (see that script's own doc comment for why).
 *
 * Warns, never fails, when `gh` isn't installed/authenticated or the origin
 * remote isn't a recognizable GitHub URL -- this check cannot tell
 * "genuinely unprotected" apart from "couldn't check" in that case, matching
 * the same fail-open-to-warn posture `Accessibility`/`SecuritySocket` already
 * take for their own environment-dependent preconditions.
 */
import path from "node:path"
import type { CheckDefinitionConfig, PolicyResult } from "repo-contract"
import { packageRoot, parseToolEnvelope } from "./shared.js"

const branchProtectionScript = path.join(packageRoot, "scripts", "check-branch-protection.mjs")

interface BranchProtectionStatus {
  readonly owner: string
  readonly repo: string
  readonly defaultBranch: string
  readonly hasDeletion: boolean
  readonly hasNonFastForward: boolean
  readonly hasPullRequest: boolean
}

type ToolResult =
  ({ readonly ok: true } & BranchProtectionStatus) | { readonly ok: false; readonly error: string }

export const branchProtection: CheckDefinitionConfig = {
  run: ["node", branchProtectionScript],
  output: { format: "json" },
  policy: ({ result }): PolicyResult => {
    const envelope = parseToolEnvelope<ToolResult>(result, "gh", "Branch protection: gh")
    if (!envelope.ok) return envelope.result

    const status = envelope.value
    if (!status.ok) {
      return { outcome: "warn", rationale: `Branch protection: ${status.error}` }
    }

    const missing: string[] = []
    if (!status.hasDeletion) missing.push("deletion protection")
    if (!status.hasPullRequest) missing.push("a pull-request-required rule")
    if (!status.hasNonFastForward) missing.push("force-push protection")

    if (missing.length > 0) {
      return {
        outcome: "fail",
        rationale: `Branch protection: ${status.owner}/${status.repo}'s default branch (${status.defaultBranch}) is missing ${missing.join(" and ")}. Run \`internal-package-contract init\` to configure it.`,
      }
    }

    return {
      outcome: "pass",
      rationale: `Branch protection: ${status.owner}/${status.repo}'s default branch (${status.defaultBranch}) blocks deletion, force-pushes, and merging without a PR.`,
    }
  },
}
