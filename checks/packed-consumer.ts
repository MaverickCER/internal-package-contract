/**
 * `PackedConsumer`: the tarball npm would publish installs into an empty project, and every entry
 * point imports.
 *
 * Reads: the tarball packed from the working directory with install scripts off, installed under
 * the temporary directory. Each entry of the export map is imported the way a consumer would, and
 * `require`d where CommonJS is promised. Every file package.json promises is checked against the
 * tarball. All through `scripts/check-packed-consumer.mjs` and `scripts/packed-consumer/plan.mjs`.
 * Source tests cannot show this: they run the source, not what npm ships.
 *
 * Fails on an entry that does not import, and on a promised file the tarball lacks. An entry that
 * fails only because a declared peer dependency is absent is listed as skipped, not failed. Never
 * warns on a finding. Passes for a private package, and for a package with no entry point.
 *
 * Exceptions: none for a finding. One degradation, `PackedConsumer:install`: the install itself
 * could not run (no network, an unreachable registry). It warns locally. Under `--strict`, the CI
 * default, it fails unless `.repo-contract/exceptions/environment.json` holds a complete record.
 * The record id is `environment:PackedConsumer:install`.
 *
 * Runs in the consumer `contract` job and in both git hooks. It runs after `Tests`, so two packs
 * never race. The shared release workflow runs the script again on the tarball it is about to
 * publish. IPC's own self-contract leaves it out: this package is never packed for npm.
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
