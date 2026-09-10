/**
 * Commit-message governance via commitlint (the `commitlint` preset).
 *
 * Uses the consumer's own commitlint config if present, otherwise the bundled
 * baseline (`config/commitlint.config.mjs` -> `@commitlint/config-conventional`,
 * which ships with this package).
 *
 * Lints `origin/main..HEAD`. Two situations become a `warn` instead of a hard
 * fail, because neither is "you regressed", which is what this check is for on a
 * PR:
 *   - no `origin/main` at all (fresh local repo, shallow CI checkout) -- there
 *     is nothing to lint;
 *   - EVERY commit in the range is non-conforming and there are many of them
 *     (>= {@link PRE_ADOPTION_THRESHOLD}) -- that is a branch that predates the
 *     standard, not a typo. The fix (`git rebase -i origin/main` to reword, or a
 *     squash-merge) is a git-history operation the maintainer performs, and the
 *     warn spells it out.
 * A mix of conforming and non-conforming commits, or just a few bad ones, still
 * fails -- that is a real regression.
 */
import type { CheckDefinitionConfig, PolicyResult } from "repo-contract"
import { commitlint as commitlintPreset } from "repo-contract/presets"
import { combinedOutput, resolveConfig } from "./shared.js"

/** At or above this many consecutive non-conforming commits, treat the range as pre-adoption history (`warn`) rather than a regression (`fail`). */
const PRE_ADOPTION_THRESHOLD = 8

const CONFIG_CANDIDATES = [
  "commitlint.config.js",
  "commitlint.config.mjs",
  "commitlint.config.cjs",
  "commitlint.config.ts",
  ".commitlintrc",
  ".commitlintrc.json",
  ".commitlintrc.js",
  ".commitlintrc.cjs",
  ".commitlintrc.mjs",
  ".commitlintrc.yml",
  ".commitlintrc.yaml",
]

/**
 * @param options.from - base ref (default `origin/main`).
 * @returns the `Commits` check.
 */
export function commits(options: { readonly from?: string } = {}): CheckDefinitionConfig {
  const from = options.from ?? "origin/main"
  const config = resolveConfig(CONFIG_CANDIDATES, "commitlint.config.mjs")
  const preset = commitlintPreset({ from })
  const presetPolicy = preset.policy

  const run = config.isBundled
    ? [...(preset.run as string[]), "--config", config.path]
    : (preset.run as string[])

  return {
    ...preset,
    run,
    policy: (ctx): PolicyResult | Promise<PolicyResult> => {
      const printed = combinedOutput(ctx.result)
      if (
        ctx.result.exitCode !== 0 &&
        /unknown revision|ambiguous argument|bad revision|not a git repository/i.test(printed)
      ) {
        return {
          outcome: "warn",
          rationale: `Commits: could not resolve \`${from}..HEAD\` -- nothing to lint (fresh repo or missing base branch). Fetch \`${from}\` in CI to enable this check.`,
        }
      }

      // commitlint prints one `⧗   --- input ---` block per FAILING commit
      // (passing commits produce no output). Many failing commits in one range
      // is a branch that predates the standard, not a regression.
      const failingCommits = (printed.match(/⧗\s+--- input ---/g) ?? []).length
      if (ctx.result.exitCode !== 0 && failingCommits >= PRE_ADOPTION_THRESHOLD) {
        return {
          outcome: "warn",
          rationale: [
            `Commits: ${String(failingCommits)} commits in \`${from}..HEAD\` are not Conventional Commits -- this looks like history that predates the standard, not a regression.`,
            "Resolve it as a git-history operation before merge:",
            `  - squash-merge the branch (one conforming message), or`,
            `  - \`git rebase -i ${from}\` and \`reword\` each with a \`type: subject\` header.`,
            "New commits on top of a conforming base will fail here as usual.",
          ].join("\n"),
        }
      }

      return presetPolicy(ctx)
    },
  }
}
