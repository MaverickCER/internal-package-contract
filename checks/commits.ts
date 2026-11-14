/**
 * `Commits`: every commit since `origin/main` is a Conventional Commit.
 *
 * Reads: `origin/main..HEAD` through commitlint (repo-contract's `commitlint` preset). The config
 * is the package's own when one exists, else the bundled `config/commitlint.config.mjs`, which
 * extends `@commitlint/config-conventional`.
 *
 * Fails as the preset does: one or more non-conforming commits in the range. Never warns on its
 * own.
 *
 * Exceptions: none for a bad message; reword it (`git rebase -i origin/main`) or squash-merge. Two
 * degradations exist. `Commits:no-base`: `origin/main` cannot be resolved (a fresh clone, a shallow
 * CI checkout). `Commits:pre-adoption`: at least {@link PRE_ADOPTION_THRESHOLD} commits in the
 * range fail, whatever else the range holds. That reads as history older than the standard. Each
 * warns locally. Under `--strict`, the CI default, each fails unless
 * `.repo-contract/exceptions/environment.json` holds a complete record. The record id is
 * `environment:Commits:<code>`.
 *
 * Runs in the consumer `contract` job, in both git hooks, and in IPC's own self-contract.
 */
import type { CheckDefinitionConfig, PolicyResult } from "repo-contract"
import { commitlint as commitlintPreset } from "repo-contract/presets"
import { degraded } from "./environment-exceptions.js"
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
        return degraded({
          check: "Commits",
          code: "no-base",
          rationale: `Commits: could not resolve \`${from}..HEAD\`, so there is nothing to lint (fresh repo or missing base branch). Fetch \`${from}\` in CI to enable this check.`,
        })
      }

      // commitlint prints one `⧗   --- input ---` block per FAILING commit
      // (passing commits produce no output). Many failing commits in one range
      // is a branch that predates the standard, not a regression.
      //
      // Stryker disable next-line ArrayDeclaration: an equivalent mutant -- `String.prototype
      // .match` with a global regex returns `null` (never `undefined`) on zero matches, so this
      // `?? []` fallback IS reachable, but Stryker's own injected replacement is always a
      // single-element array (`.length` 1), and `PRE_ADOPTION_THRESHOLD` is 8: no input can ever
      // make a 0-vs-1 difference cross that threshold, and `failingCommits`' exact value is never
      // read anywhere else. Hand-verified: forcing the fallback to a 1-element array leaves every
      // test in commits.test.ts passing unchanged.
      const failingCommits = (printed.match(/⧗\s+--- input ---/g) ?? []).length
      if (ctx.result.exitCode !== 0 && failingCommits >= PRE_ADOPTION_THRESHOLD) {
        return degraded({
          check: "Commits",
          code: "pre-adoption",
          rationale: [
            `Commits: ${String(failingCommits)} commits in \`${from}..HEAD\` are not Conventional Commits; this looks like history that predates the standard, not a regression.`,
            "Resolve it as a git-history operation before merge:",
            `  - squash-merge the branch (one conforming message), or`,
            `  - \`git rebase -i ${from}\` and \`reword\` each with a \`type: subject\` header.`,
            "New commits on top of a conforming base will fail here as usual.",
          ].join("\n"),
        })
      }

      return presetPolicy(ctx)
    },
  }
}
