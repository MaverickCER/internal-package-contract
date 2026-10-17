/**
 * Checks that are not part of the standard set, which a package turns on by name. A package lists them in
 * package.json, `"internal-package-contract": { "checks": ["AmbientCapabilities"] }`, so one it does not need
 * never runs and never has to be waived (`add check <name>` writes the entry).
 */
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import type { CheckDefinitionConfig } from "repo-contract"
import { agentSkillCheck } from "./agent-skill.js"
import { ambientCapabilitiesCheck } from "./ambient-capabilities.js"

/** The checks a package may turn on, by the name it lists them under, and where each one waits. */
export const OPTIONAL_CHECKS: Readonly<
  Record<
    string,
    { readonly check: () => CheckDefinitionConfig; readonly dependsOn: readonly string[] }
  >
> = {
  // Reads source files only, so it waits for nothing.
  AgentSkill: { check: agentSkillCheck, dependsOn: [] },
  // The packed tarball is what is read, so the build it packs must be done: `Tests` runs after `Build`.
  AmbientCapabilities: { check: ambientCapabilitiesCheck, dependsOn: ["Tests"] },
}

/**
 * @param cwd - the package's root.
 * @returns the optional checks its package.json turns on, as the contract's check definitions.
 * @throws if it names a check that does not exist, naming the ones that do.
 */
export function optionalChecks(
  cwd: string,
): Record<string, CheckDefinitionConfig & { readonly dependsOn: readonly string[] }> {
  const file = path.join(cwd, "package.json")
  if (!existsSync(file)) return {}
  const named: unknown = (
    JSON.parse(readFileSync(file).toString()) as {
      "internal-package-contract"?: { checks?: unknown }
    }
  )["internal-package-contract"]?.checks
  if (!Array.isArray(named)) return {}
  return Object.fromEntries(
    named.map((name: unknown) => {
      const found = Object.hasOwn(OPTIONAL_CHECKS, String(name))
        ? OPTIONAL_CHECKS[String(name)]
        : undefined
      if (found === undefined) {
        throw new Error(
          `package.json turns on a check that does not exist: ${String(name)}. Available: ${Object.keys(OPTIONAL_CHECKS).join(", ")}.`,
        )
      }
      const { check, dependsOn } = found
      return [String(name), { ...check(), dependsOn }]
    }),
  )
}

/**
 * @param standard - the standard checks, in schedule order, `Mutation` last.
 * @param optional - the optional ones to add.
 * @returns every check, with the optional ones just before `Mutation`, which is isolated and must run last.
 */
export function withOptionalChecks<T>(
  standard: Record<string, T>,
  optional: Record<string, T>,
): Record<string, T> {
  const { Mutation: last, ...rest } = standard
  return last === undefined
    ? { ...standard, ...optional }
    : { ...rest, ...optional, Mutation: last }
}
