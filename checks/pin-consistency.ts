/**
 * `PinConsistency`: the three pins of this package in a consumer name one revision.
 *
 * Reads, offline: the `devDependency` ref in package.json, and the commit package-lock.json
 * resolved it to. Also the commit SHA of every reusable workflow under `.github/workflows/*.yml`
 * that calls this repository. Through `scripts/check-pin-consistency.mjs` and
 * `scripts/pin-consistency.mjs`.
 *
 * Fails on any disagreement: the repository would run one revision's checks and another revision's
 * release. Never warns. Passes when the repository does not depend on this package.
 *
 * Exceptions: none. `internal-package-contract upgrade <tag>` re-pins all three; nothing here
 * rewrites a pin.
 *
 * Runs in the consumer `contract` job and in both git hooks. IPC's own self-contract leaves it out:
 * this repository is the pinned package, not a consumer.
 *
 * Limit: it does not check that the commit is reachable from this repository's default branch. That
 * needs the network (`scripts/pin-audit.mjs`, run by hand).
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
            "The pins of internal-package-contract disagree; re-sync them with `internal-package-contract upgrade <tag>` (the tag you want everything on) and commit the result:",
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
