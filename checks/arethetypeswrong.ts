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
      value = JSON.parse(
        await readFile(path.join(process.cwd(), "reports/arethetypeswrong.json"), "utf8"),
      )
    } catch {
      return {
        outcome: "fail",
        rationale: "TypeResolution: @arethetypeswrong/cli did not produce a readable JSON report.",
      }
    }

    // Drop `node10` resolution problems -- the legacy pre-`exports` resolver is
    // not a target for a package that publishes modern `exports`.
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

    // Hand the (filtered) report to repo-contract's own preset policy as if attw
    // had printed it to stdout -- reuses `evaluateAttwReport` (not on the public
    // export surface) plus the preset's dependency/termination guards.
    const synthetic: PolicyContext = {
      ...ctx,
      result: {
        ...ctx.result,
        output: { format: "json", success: true, value },
      },
    }

    return arethetypeswrongPreset.policy(synthetic)
  },
}
