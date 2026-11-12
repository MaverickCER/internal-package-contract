/**
 * `AmbientCapabilities`: the package that would be published reaches no filesystem, process or
 * environment its caller did not hand it.
 *
 * Reads: the tarball `npm pack` would publish, unpacked and scanned by
 * `scripts/check-ambient-capabilities.mjs` and `scripts/ambient/scan.mjs`. The rules come from
 * package.json's `"internal-package-contract"."ambientCapabilities"`: what must not be reached, and
 * which entry points may. The tarball is what a consumer receives, and what a bundler may have
 * pulled more code into.
 *
 * Fails on a shipped file that reaches a forbidden capability. Fails on a forbidden dependency in
 * package.json. Fails on an invalid `ambientCapabilities` setting, and when the tarball cannot be
 * packed or unpacked. Never warns. Passes for a private package, which publishes nothing.
 *
 * Exceptions: none in a registry. An entry point that must reach a capability (a `bin`, an export
 * such as `./node`) is listed under `"ambientCapabilities"."<capability>"`.
 *
 * Not in the standard set: a package turns it on by name (`add check AmbientCapabilities`). It then
 * waits on `Tests`, so the build it packs is done.
 *
 * Limit: a textual scan. It catches a literal `require("child_process")` or `process.env`; it
 * cannot show that no indirect route exists.
 */
import path from "node:path"
import type { CheckDefinitionConfig, PolicyResult } from "repo-contract"
import { packageRoot, parseToolEnvelope } from "./shared.js"

const scriptPath = path.join(packageRoot, "scripts", "check-ambient-capabilities.mjs")

interface AmbientReport {
  readonly ok: boolean
  readonly state: "exempt" | "misconfigured" | "unpacked" | "clean" | "violations"
  readonly checked?: number
  readonly problems?: readonly string[]
  readonly message?: string
  readonly violations?: readonly { file: string; capability: string; hit: string }[]
}

const WHAT: Record<string, string> = {
  child_process: "starts a process itself",
  fs: "reaches the filesystem itself",
  env: "reads the environment itself",
  dependencies: "depends on a package it must not",
}

/** @returns the `AmbientCapabilities` check. */
export function ambientCapabilitiesCheck(): CheckDefinitionConfig {
  return {
    run: ["node", scriptPath],
    output: { format: "json" },
    policy: ({ result }): PolicyResult => {
      const envelope = parseToolEnvelope<AmbientReport>(
        result,
        "check-ambient-capabilities",
        "AmbientCapabilities:",
      )
      if (!envelope.ok) return envelope.result
      const { state, checked = 0, problems = [], message = "", violations = [] } = envelope.value
      switch (state) {
        case "exempt":
          return {
            outcome: "pass",
            rationale:
              "AmbientCapabilities: this package is private, so nothing it ships is received.",
          }
        case "clean":
          return {
            outcome: "pass",
            rationale: `AmbientCapabilities: none of the ${String(checked)} shipped file(s) reaches a capability the package must be handed, and no forbidden dependency is declared.`,
          }
        case "misconfigured":
          return {
            outcome: "fail",
            rationale: [
              'AmbientCapabilities: "internal-package-contract"."ambientCapabilities" in package.json is not valid:',
              ...problems.map((line) => `- ${line}`),
            ].join("\n"),
          }
        case "unpacked":
          return { outcome: "fail", rationale: `AmbientCapabilities: ${message}` }
        default:
          return {
            outcome: "fail",
            rationale: [
              `AmbientCapabilities: the package that would be published reaches what it must be handed (${String(violations.length)} finding(s)):`,
              ...violations.map(
                ({ file, capability, hit }) =>
                  `- ${file} ${WHAT[capability] ?? capability} (${hit}). Take it from the caller, or list this entry point under "ambientCapabilities"."${capability}".`,
              ),
            ].join("\n"),
          }
      }
    },
  }
}
