// Entry point for the `BranchProtection` check (see checks/branch-protection.ts). Reads the GitHub
// rulesets of the repository `origin` points at and prints one JSON envelope describing what they enforce on
// the default branch. The policy decides the verdict; this reports and never judges.
//
// What is read, through the `gh` CLI: the default branch, every active branch ruleset, and the rules of
// each ruleset whose conditions cover that branch (scripts/github-repo.mjs decides which do). `gh` is used
// so the check borrows the login a person or CI already has: `gh auth login` locally, GH_TOKEN or
// GITHUB_TOKEN in Actions.
//
// What is reported: whether `deletion`, `non_fast_forward`, `pull_request` and `required_status_checks`
// rules exist, the status-check contexts required, whether that rule is strict (the branch must be up to
// date with its base before it merges), and whether review threads must be resolved. Also the aggregate job
// the package's own CI defines: a workflow under `.github/workflows` with both a `contract` and a `required`
// job. The policy asks for `contract` among the required checks, and for `required` when that job exists.
//
// Read-only: nothing here creates or changes a ruleset; `internal-package-contract init --github` does
// that with the same owner/repo resolution. `gh` missing or not logged in, an `origin` that is not a
// GitHub URL, or an API call that fails is `{ ok: false, error }`. The policy records that as the
// `BranchProtection:gh-unavailable` degradation: a warning locally, a failure under `--strict` in CI
// unless `.repo-contract/exceptions/environment.json` accepts it. A ruleset whose detail cannot be read
// is skipped, so the envelope then reads as unprotected rather than as a degradation.

import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { sync as spawnSync } from "cross-spawn"
import { parse } from "yaml"
import { resolveOwnerRepo, rulesetCoversBranch } from "./github-repo.mjs"

/**
 * @param {string} cwd - the package root.
 * @returns {string | null} the first workflow (by file name) that defines both a `contract` and a `required`
 *   job, or null. A workflow that cannot be read or parsed is skipped.
 */
function aggregateWorkflow(cwd) {
  const dir = path.join(cwd, ".github", "workflows")
  let files
  try {
    files = readdirSync(dir)
  } catch {
    return null
  }
  for (const file of files.filter((name) => /\.ya?ml$/.test(name)).sort()) {
    let jobs
    try {
      jobs = parse(readFileSync(path.join(dir, file), "utf8"))?.jobs
    } catch {
      continue
    }
    if (jobs && typeof jobs === "object" && "contract" in jobs && "required" in jobs)
      return `.github/workflows/${file}`
  }
  return null
}

function gh(args) {
  return spawnSync("gh", args, { encoding: "utf8" })
}

function report(value) {
  process.stdout.write(JSON.stringify(value))
  process.exitCode = 0
}

function main() {
  if (gh(["--version"]).status !== 0) {
    return report({
      ok: false,
      error: "gh CLI not found; install it to check GitHub branch protection.",
    })
  }
  if (gh(["auth", "status"]).status !== 0) {
    return report({
      ok: false,
      error: "gh CLI is not authenticated; run `gh auth login` to check GitHub branch protection.",
    })
  }

  const ownerRepo = resolveOwnerRepo()
  if (!ownerRepo) {
    return report({
      ok: false,
      error: "could not resolve a GitHub owner/repo from `git remote get-url origin`.",
    })
  }
  const { owner, repo } = ownerRepo

  const repoInfo = gh(["api", `repos/${owner}/${repo}`, "--jq", ".default_branch"])
  if (repoInfo.status !== 0) {
    return report({
      ok: false,
      error: `gh api could not read repos/${owner}/${repo}: ${repoInfo.stderr.trim()}`,
    })
  }
  const defaultBranch = repoInfo.stdout.trim()

  const rulesetList = gh(["api", `repos/${owner}/${repo}/rulesets`])
  if (rulesetList.status !== 0) {
    return report({
      ok: false,
      error: `gh api could not read repos/${owner}/${repo}/rulesets: ${rulesetList.stderr.trim()}`,
    })
  }

  const summaries = JSON.parse(rulesetList.stdout || "[]")
  const activeBranchRulesetIds = summaries
    .filter((r) => r.target === "branch" && r.enforcement === "active")
    .map((r) => r.id)

  const ruleTypes = new Set()
  const requiredChecks = new Set()
  let requiresThreadResolution = false
  let strictStatusChecks = false
  for (const id of activeBranchRulesetIds) {
    const detail = gh(["api", `repos/${owner}/${repo}/rulesets/${String(id)}`])
    if (detail.status !== 0) continue
    const ruleset = JSON.parse(detail.stdout || "{}")
    if (!rulesetCoversBranch(ruleset, defaultBranch)) continue
    for (const rule of ruleset.rules ?? []) {
      ruleTypes.add(rule.type)
      if (
        rule.type === "pull_request" &&
        rule.parameters?.required_review_thread_resolution === true
      ) {
        requiresThreadResolution = true
      }
      if (rule.type === "required_status_checks") {
        for (const c of rule.parameters?.required_status_checks ?? []) requiredChecks.add(c.context)
        if (rule.parameters?.strict_required_status_checks_policy === true)
          strictStatusChecks = true
      }
    }
  }

  report({
    ok: true,
    owner,
    repo,
    defaultBranch,
    hasDeletion: ruleTypes.has("deletion"),
    hasNonFastForward: ruleTypes.has("non_fast_forward"),
    hasPullRequest: ruleTypes.has("pull_request"),
    hasRequiredStatusChecks: ruleTypes.has("required_status_checks"),
    requiredChecks: [...requiredChecks],
    strictStatusChecks,
    requiresThreadResolution,
    aggregateWorkflow: aggregateWorkflow(process.cwd()),
  })
}

try {
  main()
} catch (error) {
  process.stdout.write(
    JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }),
  )
  process.exitCode = 1
}
