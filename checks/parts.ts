/**
 * A check is two independent halves: the **evidence** (how to collect it: the command, its working
 * directory, environment, timeout and output format) and the **policy** (what that evidence has to
 * show). Every check this package ships already has both, so none of them needs a bespoke
 * customization point: take it apart, swap the half you need and put it back.
 *
 * ```ts
 * import { standardChecks } from "internal-package-contract/checks/standard"
 * import { policyOf, withEvidence, withPolicy } from "internal-package-contract/checks/parts"
 *
 * const checks = standardChecks()
 * // Keep the standard's evidence, judge it by your own rule.
 * checks.Coverage = withPolicy(checks.Coverage, myPolicy)
 * // Keep the standard's rule, collect the evidence your own way.
 * checks.Lint = withEvidence(checks.Lint, { run: ["eslint", "--format", "json", "src"] })
 * ```
 *
 * The evidence scripts themselves (`scripts/check-*.mjs`) are exported too (`internal-package-contract/scripts/*`),
 * so a package can also run one directly, or wrap it, without going through the contract.
 */
import type { CheckDefinitionConfig } from "repo-contract"

/** Everything about a check except its policy: the part that collects evidence. */
export type EvidenceSpec = Omit<CheckDefinitionConfig, "policy">

/** The part of a check that judges evidence. */
export type CheckPolicy = CheckDefinitionConfig["policy"]

/**
 * @param check - a check definition.
 * @returns its evidence half (the command and how to read it), without the policy.
 */
export function evidenceOf(check: CheckDefinitionConfig): EvidenceSpec {
  return Object.fromEntries(
    Object.entries(check).filter(([key]) => key !== "policy"),
  ) as EvidenceSpec
}

/**
 * @param check - a check definition.
 * @returns its policy half.
 */
export function policyOf(check: CheckDefinitionConfig): CheckPolicy {
  return check.policy
}

/**
 * @param evidence - how to collect the evidence.
 * @param policy - how to judge it.
 * @returns the whole check.
 */
export function composeCheck(evidence: EvidenceSpec, policy: CheckPolicy): CheckDefinitionConfig {
  return { ...evidence, policy }
}

/**
 * @param check - the check to adapt.
 * @param policy - the policy that replaces the check's own.
 * @returns the same evidence, judged by `policy`.
 */
export function withPolicy(
  check: CheckDefinitionConfig,
  policy: CheckPolicy,
): CheckDefinitionConfig {
  return composeCheck(evidenceOf(check), policy)
}

/**
 * @param check - the check to adapt.
 * @param evidence - the fields of the evidence to replace (`run`, `output`, `cwd`, `env`, `timeoutMs`, ...).
 *   Anything left out keeps the check's own value.
 * @returns the check's own policy, over the adapted evidence.
 */
export function withEvidence(
  check: CheckDefinitionConfig,
  evidence: Partial<EvidenceSpec>,
): CheckDefinitionConfig {
  return composeCheck({ ...evidenceOf(check), ...evidence }, check.policy)
}

/**
 * @param checks - a set of checks, keyed by id (for example `standardChecks()`).
 * @returns the evidence half of each, keyed by id.
 */
export function evidenceOfAll(
  checks: Readonly<Record<string, CheckDefinitionConfig>>,
): Record<string, EvidenceSpec> {
  return Object.fromEntries(Object.entries(checks).map(([id, check]) => [id, evidenceOf(check)]))
}

/**
 * @param checks - a set of checks, keyed by id (for example `standardChecks()`).
 * @returns the policy half of each, keyed by id.
 */
export function policiesOfAll(
  checks: Readonly<Record<string, CheckDefinitionConfig>>,
): Record<string, CheckPolicy> {
  return Object.fromEntries(Object.entries(checks).map(([id, check]) => [id, check.policy]))
}
