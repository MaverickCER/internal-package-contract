/**
 * A consumer pins this package in three places -- the `devDependency` ref in `package.json`, the
 * commit `package-lock.json` resolved it to, and the commit SHA of every reusable workflow it calls --
 * and they must name one revision, or the repository runs one revision's checks and another
 * revision's release. This reads all three offline and fails on any disagreement (see
 * {@link file://../scripts/pin-consistency.mjs}); it never rewrites anything (`--repin` and the
 * pin-sync workflow do that).
 *
 * A repository that does not depend on this package, including this one, passes vacuously.
 *
 * It does not check that the commit is reachable from this repository's default branch; that needs
 * the network and is a separate audit.
 */
import path from "node:path"
import type { CheckDefinitionConfig, PolicyResult } from "repo-contract"
import { packageRoot, parseToolEnvelope } from "./shared.js"

const scriptPath = path.join(packageRoot, "scripts", "check-pin-consistency.mjs")

interface PinReport {
  readonly ok: boolean
  readonly applies?: boolean
  readonly problems?: readonly string[]
}

/** @returns the `PinConsistency` check. */
export function pinConsistency(): CheckDefinitionConfig {
  return {
    run: ["node", scriptPath],
    output: { format: "json" },
    policy: ({ result }): PolicyResult => {
      const envelope = parseToolEnvelope<PinReport>(
        result,
        "check-pin-consistency",
        "Pin consistency:",
      )
      if (!envelope.ok) return envelope.result

      const problems = envelope.value.problems ?? []
      if (problems.length > 0) {
        return {
          outcome: "fail",
          rationale: [
            "The pins of internal-package-contract disagree; re-sync them (`internal-package-contract --repin`) and commit the result:",
            ...problems.map((problem) => `- ${problem}`),
          ].join("\n"),
        }
      }
      return {
        outcome: "pass",
        rationale:
          envelope.value.applies === true
            ? "The devDependency, the lockfile and every workflow pin name one revision."
            : "This repository does not depend on internal-package-contract; nothing to compare.",
      }
    },
  }
}
