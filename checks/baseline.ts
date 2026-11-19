/**
 * The baseline of the report's "Compared with the standard" section: the standard itself.
 *
 * repo-contract's `explain` compares a config with its tier by default. IPC is stricter than
 * `strict`, so a config that matches the tier can still be looser than the standard. This baseline
 * holds every check `standardChecks()` runs and the settings `checks/strict.ts` passes the tier.
 *
 * It lives apart from `checks/strict.ts` because it needs `checks/standard.ts`, which imports
 * `strict.ts`. Settings come from tier metadata, so a check IPC replaced is compared only by
 * whether it is present.
 */
import type { ExplainBaseline } from "repo-contract/tiers"
import { standardChecks } from "./standard.js"
import { standardTier } from "./strict.js"

/** The name the report gives the baseline. */
export const STANDARD_BASELINE_NAME = "internal-package-contract"

/**
 * @param env - the process environment. It changes how Mutation runs, never a limit.
 * @param tier - the tier the standard hardens; a test seam, since today the standard runs every check it plans.
 * @returns the standard as a baseline for repo-contract's `explainTier`.
 */
export function standardBaseline(
  env: Readonly<Record<string, string | undefined>> = process.env,
  tier: Pick<ReturnType<typeof standardTier>["tier"], "settings" | "planned"> = standardTier(env)
    .tier,
): ExplainBaseline {
  const checks = Object.keys(standardChecks())
  return {
    name: STANDARD_BASELINE_NAME,
    checks,
    settings: tier.settings,
    // The tier plans checks IPC already runs; listing those as planned would undersell the standard.
    planned: tier.planned.filter(({ id }) => !checks.includes(id)),
  }
}
