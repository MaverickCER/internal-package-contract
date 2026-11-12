/**
 * `GitHooks`: git in this clone uses the bundled hooks, so a commit and a push run the contract
 * before CI does.
 *
 * Reads: whether the working directory is a repository, `core.hooksPath`, and the real location of
 * the bundled `hooks/` directory, through `scripts/check-git-hooks.mjs` and
 * `scripts/git-hooks.mjs`.
 *
 * Never fails. Warns when the hooks are not installed: a convenience lost, not a defect in the
 * package, and CI is the gate. Passes under CI without looking, and outside a git repository.
 *
 * Exceptions: none needed. `npx internal-package-contract install-hooks` sets `core.hooksPath` once
 * per clone. Nothing installs hooks from an install script, which a supply-chain policy would have
 * to trust.
 *
 * Runs in the consumer `contract` job, in both git hooks, and in IPC's own self-contract.
 */
import path from "node:path"
import type { CheckDefinitionConfig, PolicyResult } from "repo-contract"
import { packageRoot, parseToolEnvelope } from "./shared.js"

const scriptPath = path.join(packageRoot, "scripts", "check-git-hooks.mjs")

interface HooksReport {
  readonly ok: boolean
  readonly state?: "ci" | "not-a-repo" | "installed" | "missing"
}

/** @returns the `GitHooks` check. */
export function gitHooksCheck(): CheckDefinitionConfig {
  return {
    run: ["node", scriptPath],
    output: { format: "json" },
    policy: ({ result }): PolicyResult => {
      const envelope = parseToolEnvelope<HooksReport>(result, "check-git-hooks", "GitHooks:")
      if (!envelope.ok) return envelope.result
      switch (envelope.value.state) {
        case "installed":
          return {
            outcome: "pass",
            rationale: "GitHooks: git is using the bundled internal-package-contract hooks.",
          }
        case "ci":
          return {
            outcome: "pass",
            rationale: "GitHooks: not checked in CI, where this contract is the gate.",
          }
        case "not-a-repo":
          return { outcome: "pass", rationale: "GitHooks: not a git repository." }
        default:
          return {
            outcome: "warn",
            rationale:
              "GitHooks: the bundled hooks are not installed, so commits and pushes are not checked locally and CI will be the first to find a failure. Run `npx internal-package-contract install-hooks` once in this clone.",
          }
      }
    },
  }
}
