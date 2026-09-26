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
  const result = spawnSync("git", ["remote", "get-url", "origin"], { cwd, encoding: "utf8" })
  if (result.status !== 0) return undefined

  const url = result.stdout.trim()
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
  const include = ruleset.conditions?.ref_name?.include ?? []
  return (
    include.includes("~ALL") ||
    include.includes("~DEFAULT_BRANCH") ||
    include.includes(`refs/heads/${branch}`)
  )
}
