// Entry point for the `BranchProtection` check (see contract.ts). Verifies the
// consumer's own default branch is protected against deletion and against
// merging without a pull request, via a GitHub ruleset. Shells out to the
// `gh` CLI -- reusing whatever auth the developer/CI already has (`gh auth
// login` locally, or the ambient GH_TOKEN/GITHUB_TOKEN in Actions) -- rather
// than a raw GitHub API client; `gh` is already the fleet's standard for
// anything GitHub-API-shaped, and this package has no other network
// dependency to justify adding one.
//
// Read-only: never creates or modifies a ruleset. `bin/init.mjs`'s own `init`
// command does that, sharing this script's owner/repo resolution
// (scripts/github-repo.mjs).
//
// `gh` missing, unauthenticated, or the origin remote not being a recognizable
// GitHub URL are all reported as `{ ok: false, error }` -- distinguishable
// from "genuinely unprotected" (`{ ok: true, hasDeletion: false, ... }`) so
// the check's own policy can warn instead of fail when it simply couldn't
// check.

import { sync as spawnSync } from "cross-spawn"
import { resolveOwnerRepo, rulesetCoversBranch } from "./github-repo.mjs"

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
      error: "gh CLI not found -- install it to check GitHub branch protection.",
    })
  }
  if (gh(["auth", "status"]).status !== 0) {
    return report({
      ok: false,
      error:
        "gh CLI is not authenticated -- run `gh auth login` to check GitHub branch protection.",
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
  for (const id of activeBranchRulesetIds) {
    const detail = gh(["api", `repos/${owner}/${repo}/rulesets/${String(id)}`])
    if (detail.status !== 0) continue
    const ruleset = JSON.parse(detail.stdout || "{}")
    if (!rulesetCoversBranch(ruleset, defaultBranch)) continue
    for (const rule of ruleset.rules ?? []) ruleTypes.add(rule.type)
  }

  report({
    ok: true,
    owner,
    repo,
    defaultBranch,
    hasDeletion: ruleTypes.has("deletion"),
    hasNonFastForward: ruleTypes.has("non_fast_forward"),
    hasPullRequest: ruleTypes.has("pull_request"),
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
