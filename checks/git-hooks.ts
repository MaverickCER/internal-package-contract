/**
 * Whether git in this clone is using the bundled internal-package-contract hooks. They run the contract
 * before a commit, so a clone without them finds its failures in CI. This warns rather than fails: a
 * missing hook is a convenience lost, not a defect in the package, and CI (where this check does not
 * apply) is the gate. The fix is one explicit command, `internal-package-contract install-hooks`; nothing
 * installs the hooks as a side effect of `npm install`, because an install-time script is exactly what a
 * supply-chain policy should not have to trust.
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
