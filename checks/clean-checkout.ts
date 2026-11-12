/**
 * `CleanCheckout`: the files git tracks type-check on their own, as CI and every consumer will see
 * them.
 *
 * Reads: the git index, so staged files count. It is copied to a temporary folder with
 * `node_modules` linked in. There the package's own `typecheck` script, else `check`, runs; through
 * `scripts/check-clean-checkout.mjs` and `scripts/clean-checkout/run.mjs`.
 *
 * Fails when that type check fails: a file this machine has is ignored or was never added. Never
 * warns. Passes, saying why, when the package has neither script.
 *
 * Exceptions: none. Add the file, or fix the `.gitignore` pattern that hides it.
 *
 * Runs in the consumer `contract` job, in both git hooks, and in IPC's own self-contract.
 *
 * Limit: the tests are not run there. `GitHygiene` separately fails on an import of an untracked
 * file.
 */
import path from "node:path"
import type { CheckDefinitionConfig, PolicyResult } from "repo-contract"
import { packageRoot, parseToolEnvelope } from "./shared.js"

const scriptPath = path.join(packageRoot, "scripts", "check-clean-checkout.mjs")

interface CleanCheckoutReport {
  readonly ok: boolean
  readonly state: "passed" | "failed" | "skipped"
  readonly output: string
  readonly reason?: string
}

/** @returns the `CleanCheckout` check. */
export function cleanCheckoutCheck(): CheckDefinitionConfig {
  return {
    run: ["node", scriptPath],
    output: { format: "json" },
    policy: ({ result }): PolicyResult => {
      const envelope = parseToolEnvelope<CleanCheckoutReport>(
        result,
        "check-clean-checkout",
        "CleanCheckout:",
      )
      if (!envelope.ok) return envelope.result
      const { state, output, reason = "" } = envelope.value
      if (state === "skipped") {
        return { outcome: "pass", rationale: `CleanCheckout: not tried, because ${reason}.` }
      }
      if (state === "passed") {
        return {
          outcome: "pass",
          rationale: "CleanCheckout: what git tracks type-checks on its own, as CI will see it.",
        }
      }
      return {
        outcome: "fail",
        rationale: [
          "CleanCheckout: the files git tracks do not type-check on their own, so CI and every consumer will fail where this machine passes (a file is ignored or was never added):",
          output.trimEnd(),
        ].join("\n"),
      }
    },
  }
}
