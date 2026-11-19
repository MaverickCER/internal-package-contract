/**
 * `TypeResolution`: the published types resolve under every module resolution a consumer may use.
 *
 * Reads: a tarball `scripts/run-attw.mjs` packs with `--ignore-scripts`; that script runs
 * `@arethetypeswrong/cli`. attw's JSON goes to `reports/arethetypeswrong.json`, because it
 * truncates on a pipe once a package has several entry points.
 *
 * Fails when the run did not finish, and when the report is missing or unreadable. Otherwise the
 * verdict is the `TypeResolution` check of repo-contract's `strict` tier, built with
 * `ignoreResolutions: ["node10"]`: a package with modern `exports` does not serve that resolver. A
 * `private: true` package passes as not applicable.
 *
 * Exceptions: none.
 *
 * Runs in the consumer `contract` job and in both git hooks, after `Tests`, so two packs never
 * race. IPC's own self-contract leaves it out: this package is never packed for npm.
 */
import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import type { CheckDefinitionConfig, PolicyContext, PolicyResult } from "repo-contract"
import { abnormalTermination, combinedOutput } from "./shared.js"

const scriptPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "scripts",
  "run-attw.mjs",
)

/**
 * The tier's check, fed from the report file `run-attw.mjs` writes instead of attw's stdout.
 * @param check - the `TypeResolution` check of repo-contract's `strict` tier.
 * @returns the check IPC runs.
 */
export function typeResolutionCheck(check: CheckDefinitionConfig): CheckDefinitionConfig {
  // attw's stdout is not read: the report file is, so the tier's JSON output setting is dropped.
  const rest = Object.fromEntries(
    Object.entries(check).filter(([key]) => key !== "output"),
  ) as Omit<CheckDefinitionConfig, "output">
  return {
    ...rest,
    run: ["node", scriptPath, "--exclude=schema"],
    policy: async (ctx): Promise<PolicyResult> => {
      const terminated = abnormalTermination(ctx.result, "@arethetypeswrong/cli")
      if (terminated) return { outcome: "fail", rationale: `TypeResolution: ${terminated}` }

      let value: unknown
      try {
        value = JSON.parse(
          String(await readFile(path.join(process.cwd(), "reports/arethetypeswrong.json"))),
        )
      } catch (error) {
        // The tier's policy still runs: a private package passes as not applicable without a report.
        const verdict = await check.policy(
          withOutput(ctx, { success: false, error: String(error) }),
        )
        if (verdict.outcome !== "fail") return verdict
        const printed = combinedOutput(ctx.result).slice(-3000)
        return {
          outcome: "fail",
          rationale: `TypeResolution: @arethetypeswrong/cli did not produce a readable JSON report.${printed ? `\n${printed}` : ""}`,
        }
      }
      return check.policy(withOutput(ctx, { success: true, value }))
    },
  }
}

/**
 * @param ctx - the context the policy was called with.
 * @param parsed - the report, as the tier's policy expects attw's stdout parsed.
 * @returns the same context, carrying the report as the run's JSON output.
 */
function withOutput(
  ctx: PolicyContext,
  parsed:
    | { readonly success: true; readonly value: unknown }
    | { readonly success: false; readonly error: string },
): PolicyContext {
  return { ...ctx, result: { ...ctx.result, output: { format: "json", ...parsed } } }
}
