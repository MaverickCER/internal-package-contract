// What this package knows about a consumer's GitHub repository, shared so every reader and writer of a
// ruleset agrees. It knows which `{ owner, repo }` the `origin` remote names (ssh or https) and which ruleset
// covers the default branch. It knows which rules and status checks a default branch must require, and how
// to add what is missing without loosening anything present.
//
// The owner/repo pair is read by scripts/check-branch-protection.mjs, scripts/code-scanning-alerts.mjs
// and checks/socket-guidance.ts; checks/branch-protection.ts takes the required `contract` context from
// here; `init --github` (bin/scaffold.mjs) writes the ruleset with the same rules. The required status
// checks are pinned to GitHub Actions' app id, so a check of the same name from another app cannot
// satisfy the rule.

import { sync as spawnSync } from "cross-spawn"

const SSH_PATTERN = /^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/
const HTTPS_PATTERN = /^https:\/\/github\.com\/([^/]+)\/(.+?)(?:\.git)?$/

/**
 * @param {string} [cwd]
 * @returns {{ owner: string, repo: string } | undefined}
 */
export function resolveOwnerRepo(cwd = process.cwd()) {
  const result = spawnSync("git", ["remote", "get-url", "origin"], { cwd })
  // A failed `git` prints nothing on stdout (and a missing one has none), which no pattern matches.
  // `String` turns the output buffer into text.
  const url = String(result.stdout).trim()
  const match = SSH_PATTERN.exec(url) ?? HTTPS_PATTERN.exec(url)
  if (!match) return undefined

  return { owner: match[1], repo: match[2] }
}

/**
 * Whether a ruleset's `ref_name` conditions cover the given branch. Shared by
 * scripts/check-branch-protection.mjs (reading) and bin/scaffold.mjs (writing) so
 * both agree on which ruleset "is the one guarding the default branch."
 * @param {{ conditions?: { ref_name?: { include?: string[] } } }} ruleset
 * @param {string} branch
 * @returns {boolean}
 */
export function rulesetCoversBranch(ruleset, branch) {
  const include = ruleset.conditions?.ref_name?.include
  return ["~ALL", "~DEFAULT_BRANCH", `refs/heads/${branch}`].some((ref) => include?.includes(ref))
}

/** The status-check context every consumer's default branch must require before a merge. */
export const REQUIRED_STATUS_CHECK_CONTEXT = "contract"
/** The second required context: the aggregator job that stands for every other job in the workflow. */
export const REQUIRED_AGGREGATE_CONTEXT = "required"
/** GitHub Actions' app id: pinning it means a check of the same name from another app cannot satisfy the rule. */
export const GITHUB_ACTIONS_APP_ID = 15368
/** Every status check the default branch requires, each pinned to GitHub Actions. */
export const REQUIRED_STATUS_CHECKS = [
  { context: REQUIRED_STATUS_CHECK_CONTEXT, integration_id: GITHUB_ACTIONS_APP_ID },
  { context: REQUIRED_AGGREGATE_CONTEXT, integration_id: GITHUB_ACTIONS_APP_ID },
]

/**
 * @typedef {{ type: string, parameters?: Record<string, unknown> }} RulesetRule
 */

/** @param {string} type @returns {RulesetRule} */
function defaultRuleFor(type) {
  if (type === "pull_request") {
    return {
      type,
      parameters: {
        required_approving_review_count: 0,
        dismiss_stale_reviews_on_push: false,
        require_code_owner_review: false,
        require_last_push_approval: false,
        required_review_thread_resolution: true,
      },
    }
  }
  if (type === "required_status_checks") {
    return {
      type,
      parameters: {
        strict_required_status_checks_policy: true,
        do_not_enforce_on_create: false,
        required_status_checks: REQUIRED_STATUS_CHECKS,
      },
    }
  }
  return { type }
}

/** The rule types every default-branch ruleset must carry. */
export const REQUIRED_RULE_TYPES = [
  "deletion",
  "non_fast_forward",
  "pull_request",
  "required_status_checks",
]

/**
 * Adds every missing required rule to `existing`. It also tightens the two settings a rule can carry
 * while still being "present but useless". One is a `pull_request` rule that does not require review
 * threads to be resolved. The other is a `required_status_checks` rule that is not strict or that does
 * not require {@link REQUIRED_STATUS_CHECK_CONTEXT}. Never removes or loosens anything.
 * @param {readonly RulesetRule[]} existing
 * @returns {{ rules: RulesetRule[], changes: string[] }}
 */
export function mergeRequiredRules(existing) {
  const changes = []
  const rules = existing.map((rule) => {
    if (
      rule.type === "pull_request" &&
      rule.parameters?.required_review_thread_resolution !== true
    ) {
      changes.push("require review threads to be resolved")
      return {
        ...rule,
        parameters: { ...rule.parameters, required_review_thread_resolution: true },
      }
    }
    if (rule.type === "required_status_checks") {
      const params = rule.parameters ?? {}
      const checks = Array.isArray(params.required_status_checks)
        ? params.required_status_checks
        : []
      const missing = REQUIRED_STATUS_CHECKS.filter(
        (required) => !checks.some((c) => c?.context === required.context),
      )
      if (params.strict_required_status_checks_policy !== true || missing.length > 0) {
        changes.push(
          `require the ${REQUIRED_STATUS_CHECKS.map((c) => c.context).join(" and ")} checks (strict)`,
        )
        return {
          ...rule,
          parameters: {
            ...params,
            strict_required_status_checks_policy: true,
            required_status_checks: [...checks, ...missing],
          },
        }
      }
    }
    return rule
  })
  const present = new Set(rules.map((r) => r.type))
  for (const type of REQUIRED_RULE_TYPES) {
    if (!present.has(type)) {
      rules.push(defaultRuleFor(type))
      changes.push(`add ${type}`)
    }
  }
  return { rules, changes }
}
