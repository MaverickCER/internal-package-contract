import type { ExceptionPolicy, ExceptionPolicyConfig } from "repo-contract/helpers"

/**
 * The `CodeRabbit` check's own instantiation of `repo-contract/helpers`' classification-neutral
 * exception policy (see repo-contract's own
 * specs/decisions/0013-reusable-exception-policy-helper.md) -- a single `"coderabbit"` group. Every
 * CodeRabbit finding -- an AI opinion, not a deterministic tool result -- requires a complete
 * finding-specific exception regardless of severity, so one group-level `default` expresses "every
 * severity, same requirements". Required fields: `justification`, `remediation`, `method`,
 * `exceptionType` (all root fields on the reconciled record). `method` may only be
 * `"independent-human-review"` for a CodeRabbit waiver (there is no tool to mechanically re-run) --
 * enforced by `scripts/coderabbitai/registry.ts`'s exclusion of `"validated-false-positive"` from
 * its allowed `exceptionType` set.
 *
 * `alternatives` is deliberately NOT required (unlike `SecuritySocket`'s `middle`/`unknown` tier):
 * "what else could we have used instead" is a supply-chain question about a dependency choice, and
 * has no meaning for a review comment about this repository's own source line.
 */
const ALL_REQUIREMENTS = ["justification", "remediation", "method", "exceptionType"] as const

export const CODERABBIT_POLICY: ExceptionPolicyConfig = {
  coderabbit: {
    default: { mode: "exception", requirements: [...ALL_REQUIREMENTS] },
  },
}

/** Used only if a future refactor ever resolves a classification whose `group` isn't `"coderabbit"` -- never actually reached today. Kept maximally strict. */
export const CODERABBIT_GLOBAL_DEFAULT_POLICY: ExceptionPolicy = {
  mode: "exception",
  requirements: [...ALL_REQUIREMENTS],
}

/** Every field name this check's own `"exception"` mode policy may require -- passed to `validateExceptionPolicyConfig` as `validRequirements`. */
export const VALID_CODERABBIT_REQUIREMENTS = ALL_REQUIREMENTS
