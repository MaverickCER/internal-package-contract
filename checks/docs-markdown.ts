/**
 * `DocsMarkdown`: the root and `docs/` Markdown passes markdownlint.
 *
 * Reads: `*.md` and every `.md` under `docs/` through markdownlint-cli2. The config is the
 * package's own `.markdownlint-cli2.*` or `.markdownlint.*` when one exists; that config then owns
 * the globs. Else it is the bundled `config/markdownlint.jsonc`. The globs are explicit because an
 * unscoped run walks `node_modules` into an out-of-memory crash.
 *
 * Fails on any finding, read from markdownlint-cli2's exit code and printed output. Never warns.
 * Passes when the globs match nothing.
 *
 * Exceptions: none in a registry. A rule is relaxed in the package's own markdownlint config. An
 * inline `markdownlint-disable` is read back by `Suppressions`.
 *
 * Runs in the consumer `contract` job, in both git hooks, and in IPC's own self-contract.
 */
import type { CheckDefinitionConfig, PolicyResult } from "repo-contract"
import { abnormalTermination, combinedOutput, resolveConfig } from "./shared.js"

const CONFIG_CANDIDATES = [
  ".markdownlint-cli2.jsonc",
  ".markdownlint-cli2.yaml",
  ".markdownlint-cli2.cjs",
  ".markdownlint-cli2.mjs",
  ".markdownlint-cli2.json",
  ".markdownlint.jsonc",
  ".markdownlint.json",
  ".markdownlint.yaml",
]

/** @returns the `DocsMarkdown` check. */
export function docsMarkdown(): CheckDefinitionConfig {
  const config = resolveConfig(CONFIG_CANDIDATES, "markdownlint.jsonc")
  // A consumer config drives its own globs; the bundled config has none, so pass
  // explicit safe globs when falling back.
  const run = config.isBundled
    ? ["markdownlint-cli2", "--config", config.path, "*.md", "docs/**/*.md"]
    : ["markdownlint-cli2", "*.md", "docs/**/*.md"]

  return {
    run,
    policy: ({ result }): PolicyResult => {
      const terminated = abnormalTermination(result, "markdownlint-cli2")
      if (terminated) return { outcome: "fail", rationale: terminated }

      const via = config.isBundled ? " (bundled baseline rules)" : ""

      if (result.exitCode === 0) {
        return { outcome: "pass", rationale: `Docs (markdown): 0 issues${via}.` }
      }

      const printed = combinedOutput(result)
      // markdownlint-cli2 also exits non-zero when a glob matched nothing.
      if (/Linting: 0 file/.test(printed) || /no files/i.test(printed)) {
        return { outcome: "pass", rationale: "Docs (markdown): no markdown files to lint." }
      }

      return {
        outcome: "fail",
        rationale: `Docs (markdown): markdownlint-cli2 reported issue(s)${via}:\n${printed.slice(-4000)}`,
      }
    },
  }
}
