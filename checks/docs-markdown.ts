/**
 * Markdown structure/style lint via markdownlint-cli2.
 *
 * A recreation rather than the `markdownlint` preset because the preset needs the
 * consumer's config to wire a JSON output formatter, and markdownlint-cli2
 * unscoped walks node_modules into an OOM. This check scans only the root and
 * `docs/` markdown, uses the consumer's own `.markdownlint-cli2.*` if present
 * (otherwise the bundled `config/markdownlint.jsonc`), and reads
 * markdownlint-cli2's own exit code plus printed findings. Any issue blocks.
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
