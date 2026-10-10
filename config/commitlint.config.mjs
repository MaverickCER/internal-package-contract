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
  plugins: [
    {
      rules: {
        // A `Co-Authored-By:` line makes GitHub list that identity as a contributor of the
        // repository. Credit is the maintainer's to give, so no commit here carries one.
        "no-co-author-trailer": ({ raw }) => [
          !/^co-authored-by:/im.test(raw ?? ""),
          "commits must not carry a Co-Authored-By trailer; remove the line from the message",
        ],
      },
    },
  ],
  rules: {
    "no-co-author-trailer": [2, "always"],
    "body-max-line-length": [1, "always", 100],
    "footer-max-line-length": [1, "always", 100],
  },
}
