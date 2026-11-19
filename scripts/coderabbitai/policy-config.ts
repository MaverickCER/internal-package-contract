import type { ExceptionPolicy, ExceptionPolicyConfig } from "repo-contract/helpers"
import { EXCEPTION_V2_FIELD_KEYS } from "repo-contract/helpers"

/**
 * The `CodeRabbit` check's own instantiation of `repo-contract/helpers`' classification-neutral
 * exception policy (see repo-contract's own
 * specs/decisions/0013-reusable-exception-policy-helper.md): a single `"coderabbit"` group. A
 * CodeRabbit finding is an AI opinion, not a deterministic tool result. Every one needs a complete
 * finding-specific exception at any severity. So one group-level `default` says "every severity,
 * same requirements". Required fields: `justification`, `remediation`, `method`, `exceptionType`
 * (all root fields on the reconciled record). No tool can re-run an AI finding, so
 * `scripts/coderabbitai/registry.ts` rejects `method: "mechanical-reverification"`. The expected
 * method is `"independent-human-review"`. It also drops `"validated-false-positive"` from the
 * allowed `exceptionType` set.
 *
 * `alternatives` is not required here, unlike `SecuritySocket`'s `middle`/`unknown` tier. "What
 * else could we have used instead" is a supply-chain question about a dependency choice. It has no
 * meaning for a review comment about a source line in this repository.
 */
const ALL_REQUIREMENTS = [
  "justification",
  "remediation",
  "method",
  "exceptionType",
  ...EXCEPTION_V2_FIELD_KEYS,
] as const

export const CODERABBIT_POLICY: ExceptionPolicyConfig = {
  coderabbit: {
    default: { mode: "exception", requirements: [...ALL_REQUIREMENTS] },
  },
}

/** Used only if a future refactor ever resolves a classification whose `group` isn't `"coderabbit"`: never actually reached today. Kept maximally strict. */
export const CODERABBIT_GLOBAL_DEFAULT_POLICY: ExceptionPolicy = {
  mode: "exception",
  requirements: [...ALL_REQUIREMENTS],
}

/** Every field name this check's own `"exception"` mode policy may require: passed to `validateExceptionPolicyConfig` as `validRequirements`. */
export const VALID_CODERABBIT_REQUIREMENTS = ALL_REQUIREMENTS
