// Parses `git remote get-url origin` into a GitHub `{ owner, repo }` pair.
// Shared by scripts/check-branch-protection.mjs and bin/init.mjs -- neither
// this package nor repo-contract had this logic before either needed to talk
// to `gh api repos/{owner}/{repo}/...`.

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
 * scripts/check-branch-protection.mjs (reading) and bin/init.mjs (writing) so
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
        required_status_checks: [{ context: REQUIRED_STATUS_CHECK_CONTEXT }],
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
 * Adds every missing required rule to `existing`, and tightens the two settings a rule can carry
 * while still being "present but useless": a `pull_request` rule that does not require review
 * threads to be resolved, and a `required_status_checks` rule that is not strict or that does not
 * require {@link REQUIRED_STATUS_CHECK_CONTEXT}. Never removes or loosens anything.
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
      const hasContext = checks.some((c) => c?.context === REQUIRED_STATUS_CHECK_CONTEXT)
      if (params.strict_required_status_checks_policy !== true || !hasContext) {
        changes.push(`require the ${REQUIRED_STATUS_CHECK_CONTEXT} check (strict)`)
        return {
          ...rule,
          parameters: {
            ...params,
            strict_required_status_checks_policy: true,
            required_status_checks: hasContext
              ? checks
              : [...checks, { context: REQUIRED_STATUS_CHECK_CONTEXT }],
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
