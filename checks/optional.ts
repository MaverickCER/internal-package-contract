/**
 * The checks a package turns on by name instead of getting by default: `AgentSkill`,
 * `AmbientCapabilities` and `Sbom`.
 *
 * Reads: package.json `"internal-package-contract"."checks"`. A name that is not an optional check
 * throws when the contract is assembled, naming the ones that exist. A typo therefore never runs
 * nothing in silence. A retired name, such as `QuickStart`, is ignored with one line on stderr: the
 * standard runs it now.
 *
 * An optional check is placed before `Mutation`, which must stay last and isolated. It waits on
 * what `OPTIONAL_CHECKS` says it depends on. `add check <Name>` writes the entry.
 */
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import type { CheckDefinitionConfig } from "repo-contract"
import { agentSkillCheck } from "./agent-skill.js"
import { ambientCapabilitiesCheck } from "./ambient-capabilities.js"
import { sbomCheck } from "./sbom.js"
import { RETIRED_CHECKS } from "../scripts/recipes/optional-settings.mjs"

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
  // Reads the lockfile and the committed documents only, so it waits for nothing.
  Sbom: { check: sbomCheck, dependsOn: [] },
}

/**
 * @param cwd - the package's root.
 * @param say - where the line about a retired name goes; stderr by default.
 * @returns the optional checks its package.json turns on, as the contract's check definitions.
 * @throws if it names a check that does not exist, naming the ones that do.
 */
export function optionalChecks(
  cwd: string,
  say: (line: string) => void = (line) => process.stderr.write(line),
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
    named
      .filter((name: unknown) => {
        const retired = Object.hasOwn(RETIRED_CHECKS, String(name))
        if (retired) say(`${String(RETIRED_CHECKS[String(name)])}\n`)
        return !retired
      })
      .map((name: unknown) => {
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
