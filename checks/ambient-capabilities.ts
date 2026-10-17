/**
 * Proves the package that would be published takes what it touches from its caller. A library that is handed
 * its filesystem, its way to start a process and its environment lets a consumer see, and replace, everything
 * it can do, and a supply-chain scanner such as socket.dev flags every package that reaches them itself. The
 * package says which of those it must never reach and which entry points (its `bin`, an export like `./node`)
 * are the exception, in package.json under "internal-package-contract"."ambientCapabilities"; this reads the
 * tarball npm would publish, since that, not the source, is what a consumer receives and what a bundler may
 * have pulled more code into.
 *
 * A textual defense in depth, not a proof: it catches a literal reintroduction (a stray `require("child_process")`,
 * a `process.env` reference, a forbidden dependency) and cannot show that no evasion exists. It is not part of
 * the standard set; a package turns it on (see `add check AmbientCapabilities`). A private package publishes
 * nothing and is exempt.
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
