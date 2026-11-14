/**
 * `SurfaceContract`: the CLI, schema, action and workflow surface changed no more than the changesets
 * declare. That surface is the `--help` and exit code of each `bin` and of each command its help lists,
 * the JSON files `exports` serve, and the inputs, secrets and outputs of the root `action.yml` and of each
 * reusable workflow. With `surfaceRenderers` in package.json it also holds the headings of generated
 * documents. `ApiContract` guards the types; this guards the rest.
 *
 * Reads: package.json, the current surface (`scripts/surface-contract/collect.ts`), and the
 * committed `.repo-contract/surface-contract/baseline.json`. Also the pending `.changeset/*.md`,
 * and `CI`. All through `scripts/surface-contract/run.ts`.
 *
 * Fails when the difference requires a higher release level than the changesets declare. Fails when
 * the baseline records another version than package.json: the release did not refresh it, and a
 * stale baseline would let later changes pass unjudged. The `version` script runs `update-baseline`
 * so the release pull request carries the refreshed baseline. Fails when the branch itself rewrote the
 * baseline while package.json keeps the base branch's version (scripts/baseline-guard.mjs); without the
 * base branch in the clone that comparison is skipped. Fails under `CI` when the
 * package has a surface and no committed baseline. CI never creates one, so deleting the file is
 * not a way past the gate. Never warns. Passes with no CLI, schema or action. Locally with no
 * baseline, the first one is written and must be committed.
 *
 * Exceptions: none. Add a changeset at the required level, or run `internal-package-contract
 * update-baseline` after a release.
 *
 * Runs in the consumer `contract` job, in both git hooks, and in IPC's own self-contract. The
 * self-contract baselines this package's own CLI text.
 *
 * Limit: a behaviour change behind an unchanged `--help`, or in the files a CLI writes, is
 * invisible here.
 */
import path from "node:path"
import type { CheckDefinitionConfig, PolicyResult } from "repo-contract"
import type { SurfaceEvidence } from "../scripts/surface-contract/run.js"
import { abnormalTermination, packageRoot, unparseableRationale } from "./shared.js"

const script = path.join(packageRoot, "scripts", "surface-contract", "run.ts")
const BASELINE = ".repo-contract/surface-contract/baseline.json"

/**
 * @param evidence - what the script printed.
 * @returns the check's outcome and why.
 */
export function evaluateSurfacePolicy(evidence: SurfaceEvidence): PolicyResult {
  if (evidence.status === "no-surface") {
    return {
      outcome: "pass",
      rationale: "SurfaceContract: no CLI, exported JSON Schema or GitHub Action to guard.",
    }
  }
  if (evidence.status === "initial-baseline") {
    return {
      outcome: "pass",
      rationale: `SurfaceContract: no baseline existed, so ${BASELINE} was created from the current surface; commit it.`,
    }
  }
  if (evidence.status === "missing-baseline") {
    return {
      outcome: "fail",
      rationale: `SurfaceContract: this package has a CLI, schema or action but ${BASELINE} is not committed. Run \`npx internal-package-contract update-baseline\` locally and commit the result; CI never creates it.`,
    }
  }
  if (evidence.baselineEdited) {
    return {
      outcome: "fail",
      rationale: `SurfaceContract: this branch changed ${BASELINE} while package.json stays at ${evidence.currentVersion}, the base branch's version. A baseline moves only with a release, so editing it here would hide this branch's own surface change. Restore it from the base branch and declare the change with \`npx changeset add\`.`,
    }
  }
  if (evidence.baselineStale) {
    return {
      outcome: "fail",
      rationale: `SurfaceContract: ${BASELINE} records version ${String(evidence.baselineVersion)} but package.json is ${evidence.currentVersion}, so the release that set this version did not refresh it. Run \`npx internal-package-contract update-baseline\` and commit the result, and add \`internal-package-contract update-baseline\` to the \`version\` script after the build so every release pull request refreshes it.`,
    }
  }
  if (evidence.changes.length === 0) {
    return {
      outcome: "pass",
      rationale: `SurfaceContract: the CLI, schema and action surface is unchanged since ${String(evidence.baselineVersion)}.`,
    }
  }
  const { declaredLevel, changesetCount, satisfied } = evidence.changesets
  const lines = [
    `SurfaceContract: the CLI, schema or action surface changed since ${String(evidence.baselineVersion)}:`,
    ...evidence.changes.map((c) => `- [${c.impact}] ${c.explanation} (${c.id})`),
    "",
    `Release level: ${String(changesetCount)} changeset(s) declare \`${declaredLevel}\`; the surface change requires \`${evidence.requiredLevel}\`.`,
  ]
  if (!satisfied) {
    return {
      outcome: "fail",
      rationale: [
        ...lines,
        `Run \`npx changeset add\` and declare a \`${evidence.requiredLevel}\` bump for this change, so Changesets bumps the version correctly.`,
      ].join("\n"),
    }
  }
  return {
    outcome: "pass",
    rationale: [
      ...lines,
      `Minimum required version if released now: ${String(evidence.minimumRequiredVersion)}.`,
    ].join("\n"),
  }
}

/** @returns the `SurfaceContract` check. */
export function surfaceContract(): CheckDefinitionConfig {
  return {
    run: ["tsx", script],
    output: { format: "json" },
    policy: ({ result }): PolicyResult => {
      const terminated = abnormalTermination(result, "the surface-contract check")
      if (terminated) return { outcome: "fail", rationale: terminated }
      if (!result.output?.success) {
        return { outcome: "fail", rationale: unparseableRationale("SurfaceContract:", result) }
      }
      return evaluateSurfacePolicy(result.output.value as SurfaceEvidence)
    },
  }
}
