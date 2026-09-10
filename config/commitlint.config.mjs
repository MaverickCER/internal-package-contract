/**
 * Baseline commitlint config -- Conventional Commits, as the default the
 * `Commits` check uses when a consumer has no commitlint config of its own.
 * `@commitlint/config-conventional` ships with internal-package-contract.
 *
 * A consumer extends it:
 *
 *   import baseline from "internal-package-contract/config/commitlint"
 *   export default { ...baseline, rules: { ...baseline.rules, "scope-enum": [2, "always", ["core", "cli"]] } }
 *
 * @type {import('@commitlint/types').UserConfig}
 */
export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "body-max-line-length": [1, "always", 100],
    "footer-max-line-length": [1, "always", 100],
  },
}
