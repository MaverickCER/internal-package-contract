/**
 * `TypeResolution`: the published types resolve under every module resolution a consumer may use.
 *
 * Reads: a tarball packed with `--ignore-scripts` by `scripts/run-attw.mjs`, which runs
 * `@arethetypeswrong/cli`. attw's JSON goes to `reports/arethetypeswrong.json`: it truncates on a
 * pipe once a package has several entry points.
 *
 * Fails when the report is missing or unreadable. Otherwise the verdict is repo-contract's own
 * `arethetypeswrong` preset's, once `node10` problems are removed. `node10` is dropped because a
 * package with modern `exports` does not serve that resolver.
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
import { arethetypeswrong as arethetypeswrongPreset } from "repo-contract/presets"
import { abnormalTermination, combinedOutput } from "./shared.js"

const scriptPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "scripts",
  "run-attw.mjs",
)

export const arethetypeswrong: CheckDefinitionConfig = {
  run: ["node", scriptPath, "--exclude=schema"],
  policy: async (ctx): Promise<PolicyResult> => {
    const terminated = abnormalTermination(ctx.result, "@arethetypeswrong/cli")
    if (terminated) return { outcome: "fail", rationale: `TypeResolution: ${terminated}` }

    let value: unknown
    try {
      // Stryker disable StringLiteral: an equivalent mutant -- `readFile(path, "")` returns a
      // Buffer instead of a string, but `JSON.parse` coerces any non-string argument via its
      // default (utf8) `toString()`, which produces byte-for-byte the same text `"utf8"` would
      // have decoded. Hand-verified: forcing this to `""` leaves every test in
      // arethetypeswrong.test.ts passing unchanged.
      value = JSON.parse(
        await readFile(path.join(process.cwd(), "reports/arethetypeswrong.json"), "utf8"),
      )
      // Stryker restore StringLiteral
    } catch {
      const printed = combinedOutput(ctx.result).slice(-3000)
      return {
        outcome: "fail",
        rationale: `TypeResolution: @arethetypeswrong/cli did not produce a readable JSON report.${printed ? `\n${printed}` : ""}`,
      }
    }

    // Drop `node10` resolution problems: the legacy pre-`exports` resolver is
    // not a target for a package that publishes modern `exports`.
    //
    // Every `typeof x === "object"` guard below is an equivalent mutant when forced to `true` or
    // loosened (`||`, `>=`). `value` comes only from `JSON.parse`, so a truthy non-object is a string,
    // number or boolean. None of those carries an own array-valued property, so a wider guard never
    // changes `kept`. A non-object entry that did reach `kept` is still dropped downstream, by the
    // `typeof problem === "object"` filter in `evaluateAttwReport`
    // (`repo-contract/src/presets/arethetypeswrong.ts`). The verdict therefore cannot change. A
    // placeholder array in place of `[]` for a non-array `group` is filtered out the same way.
    // Hand-verified: forcing each guard to `true`, or substituting a placeholder array, one at a time,
    // leaves every test in arethetypeswrong.test.ts passing.
    // Stryker disable ConditionalExpression,LogicalOperator,EqualityOperator,ArrayDeclaration
    if (value !== null && typeof value === "object") {
      const raw = (value as { problems?: Record<string, unknown[]> }).problems
      if (raw && typeof raw === "object") {
        const kept: Record<string, unknown[]> = {}
        for (const [kind, group] of Object.entries(raw)) {
          const filtered = (Array.isArray(group) ? group : []).filter(
            (p) =>
              !(
                p &&
                typeof p === "object" &&
                (p as { resolutionKind?: string }).resolutionKind === "node10"
              ),
          )
          if (filtered.length > 0) kept[kind] = filtered
        }
        ;(value as { problems?: unknown }).problems = kept
      }
    }
    // Stryker restore ConditionalExpression,LogicalOperator,EqualityOperator,ArrayDeclaration

    // Hand the (filtered) report to repo-contract's own preset policy as if attw
    // had printed it to stdout: reuses `evaluateAttwReport` (not on the public
    // export surface) plus the preset's dependency/termination guards.
    // Stryker disable StringLiteral: an equivalent mutant -- `arethetypeswrongPreset`'s own policy
    // (and the shared `checkDependencyInstalled`/`checkTerminatedAbnormally` guards it calls
    // first) never reads `output.format`, only `output.success` and `output.value`. Hand-verified:
    // forcing this to `""` leaves every test in arethetypeswrong.test.ts passing unchanged.
    const synthetic: PolicyContext = {
      ...ctx,
      result: {
        ...ctx.result,
        output: { format: "json", success: true, value },
      },
    }
    // Stryker restore StringLiteral

    return arethetypeswrongPreset.policy(synthetic)
  },
}
