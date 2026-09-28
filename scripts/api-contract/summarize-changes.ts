import type { ApiContractChange, ContractImpact } from "./evidence-types.js"

/**
 * Ported from repo-contract's own `scripts/api-contract/summarize-changes.ts` -- this engine now
 * lives only here (see `checks/api-contract.ts`'s own note); repo-contract consumes it as a
 * devDependency rather than hosting a copy.
 *
 * Builds a target's summary deterministically from structured data -- never hand-authored per
 * scenario. `initialBaseline` and "no changes" both produce a fixed sentence; otherwise a
 * stable-ordered list built from each change's own `explanation`.
 * @param diff - The threshold-admitted, sorted list of classified contract changes.
 * @param impact - The aggregate classification of `diff`.
 * @param initialBaseline - True if this run is establishing the first-ever baseline for this target rather than comparing against a historical one.
 * @returns A deterministic, human-readable summary sentence (or list) describing the contract delta.
 */
export function summarizeChanges(
  diff: readonly ApiContractChange[],
  impact: ContractImpact,
  initialBaseline: boolean,
): string {
  if (initialBaseline) {
    return (
      "No historical public API contract exists for this target. This run establishes the " +
      "initial contract baseline; v0.1.0 is recommended as the initial package version."
    )
  }

  if (diff.length === 0) {
    return "No public API changes detected."
  }

  const header =
    impact === "unknown"
      ? "The public contract changed, but one or more changes could not be classified deterministically:"
      : `${String(diff.length)} public contract change(s) detected:`

  return [header, ...diff.map((change) => `- ${change.explanation}`)].join("\n")
}

/**
 * Formats changes visible only below the check's own `--release-tag` threshold (see
 * evidence-types.ts's `ApiContractTargetResult.lowerTierDiff`) -- informational only, deliberately
 * labeled as non-blocking since it never affects the required release level.
 * @param diff - The changes visible only below the check's `--release-tag` threshold.
 * @returns A human-readable, non-blocking summary of `diff`, or `undefined` when `diff` is empty.
 */
export function summarizeLowerTierChanges(diff: readonly ApiContractChange[]): string | undefined {
  if (diff.length === 0) return undefined

  return [
    `${String(diff.length)} non-public contract change(s) also detected (informational only -- ` +
      "does not affect the required release level):",
    ...diff.map((change) => `- ${change.explanation}`),
  ].join("\n")
}
