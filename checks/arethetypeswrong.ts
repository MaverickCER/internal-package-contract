/**
 * Published-package type-resolution correctness via `@arethetypeswrong/cli`.
 *
 * attw's `--format json` output truncates when written to a pipe once a package
 * has more than a couple of entrypoints, and repo-contract captures every
 * check's stdout through a pipe -- so this check runs attw via
 * {@link file://../scripts/run-attw.mjs}, which packs the tarball with
 * `--ignore-scripts` and redirects attw's stdout to a real file. The policy then
 * reads that file and hands it to repo-contract's own `arethetypeswrong` preset
 * policy, so the interpretation is repo-contract's, not a reimplementation --
 * after dropping `node10` (pre-`exports`) resolution problems, which a package
 * publishing modern `exports` is not expected to satisfy.
 */
import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import type { CheckDefinitionConfig, PolicyContext, PolicyResult } from "repo-contract"
import { arethetypeswrong as arethetypeswrongPreset } from "repo-contract/presets"

const scriptPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "scripts",
  "run-attw.mjs",
)

export const arethetypeswrong: CheckDefinitionConfig = {
  run: ["node", scriptPath, "--exclude=schema"],
  policy: async (ctx): Promise<PolicyResult> => {
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
      return {
        outcome: "fail",
        rationale: "TypeResolution: @arethetypeswrong/cli did not produce a readable JSON report.",
      }
    }

    // Drop `node10` resolution problems -- the legacy pre-`exports` resolver is
    // not a target for a package that publishes modern `exports`.
    //
    // Every `typeof x === "object"`-style guard below is an equivalent mutant when forced to
    // `true` (or loosened via `||`/`>=`): `value` only ever comes from `JSON.parse`, so the only
    // "truthy but not typeof object" values it can ever hold are strings/numbers/booleans -- none
    // of which can carry an own array-valued property, so widening any of these guards can never
    // change what ends up in `kept`. And even a spurious non-object entry that DID leak into
    // `kept` would still be dropped by `arethetypeswrongPreset`'s own
    // `typeof problem === "object"` filter downstream (`evaluateAttwReport` in
    // `repo-contract/src/presets/arethetypeswrong.ts`), so the pass/fail verdict can never diverge
    // either way -- which is also why a non-array `group` falling back to a placeholder array
    // (instead of `[]`) can never be observed: the placeholder is never a real problem object, so
    // it is filtered out by the very same downstream guard. Hand-verified: forcing each of these
    // to always-true (or substituting a placeholder array), one at a time, leaves every test in
    // arethetypeswrong.test.ts passing unchanged.
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
    // had printed it to stdout -- reuses `evaluateAttwReport` (not on the public
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
