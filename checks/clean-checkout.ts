/**
 * Proves the package type-checks as a clean checkout has it: only the files git tracks, with this installation's
 * dependencies. Every other check reads the working tree, where an ignored or never-added file is present, so a
 * missing file passes every one of them and fails CI and every consumer. This copies what is tracked (the index,
 * so staged files count) to a temporary folder, links `node_modules`, and runs the package's own `typecheck`
 * script (or `check`) there. It does not run the tests (`GitHygiene` also fails on an import of an untracked
 * file); a package with neither script passes, saying why it was not tried.
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
