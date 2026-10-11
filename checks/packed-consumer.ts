/**
 * Proves the package that would be published works for a consumer. It takes the packed tarball, installs
 * it into an empty project and imports every entry point in the export map the way a consumer would
 * (and `require`s the ones that promise CommonJS), also confirming that every file `package.json` promises
 * is in the tarball (see scripts/check-packed-consumer.mjs and scripts/packed-consumer/plan.mjs). Source
 * tests cannot show this: they run the source, not what npm would ship.
 *
 * An entry that fails only because a declared peer dependency is not installed (an optional integration,
 * such as an ESLint plugin) is reported as skipped, not as a failure. When the install itself cannot run
 * (no network, an unreachable registry) the check is not evaluated, recorded as an environment exception
 * like every other check that could not run. A private package publishes nothing and is exempt.
 */
import path from "node:path"
import type { CheckDefinitionConfig, PolicyResult } from "repo-contract"
import { degraded } from "./environment-exceptions.js"
import { packageRoot, parseToolEnvelope } from "./shared.js"

const scriptPath = path.join(packageRoot, "scripts", "check-packed-consumer.mjs")

interface PackedReport {
  readonly ok: boolean
  readonly state: "exempt" | "none" | "verified" | "problem" | "install-failed"
  readonly checked?: number
  readonly problems?: readonly string[]
  readonly skipped?: readonly string[]
  readonly message?: string
}

/**
 * @param input - Test seam: where the environment-exception registry is read from.
 * @param input.cwd - The repository root; defaults to the working directory.
 * @returns the `PackedConsumer` check.
 */
export function packedConsumerCheck(input: { readonly cwd?: string } = {}): CheckDefinitionConfig {
  return {
    run: ["node", scriptPath],
    output: { format: "json" },
    policy: async ({ result }): Promise<PolicyResult> => {
      const envelope = parseToolEnvelope<PackedReport>(
        result,
        "check-packed-consumer",
        "PackedConsumer:",
      )
      if (!envelope.ok) return envelope.result
      const { state, checked = 0, problems = [], skipped = [], message = "" } = envelope.value
      switch (state) {
        case "exempt":
          return {
            outcome: "pass",
            rationale: "PackedConsumer: this package is private, so there is nothing to publish.",
          }
        case "none":
          return {
            outcome: "pass",
            rationale:
              "PackedConsumer: package.json declares no entry point for a consumer to import.",
          }
        case "verified":
          return {
            outcome: "pass",
            rationale: [
              `PackedConsumer: the packed tarball installs into a clean project and all ${String(checked)} entry point(s) import.`,
              ...skipped.map((line) => `- skipped: ${line}`),
            ].join("\n"),
          }
        case "install-failed":
          return degraded({
            check: "PackedConsumer",
            code: "install",
            rationale: `the packed tarball could not be installed into a clean project, so its entry points were not imported:\n${message}`,
            cwd: input.cwd ?? process.cwd(),
          })
        default:
          return {
            outcome: "fail",
            rationale: [
              `PackedConsumer: the package that would be published does not work for a consumer (${String(problems.length)} problem(s)):`,
              ...problems.map((line) => `- ${line}`),
            ].join("\n"),
          }
      }
    },
  }
}
