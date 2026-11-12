/**
 * `DocsFragments`: every `#fragment` link in the hand-written Markdown names a heading that exists.
 *
 * Reads: `*.md` at the root and every `.md` under `docs/`, minus the generated `docs/api-report/`,
 * through `scripts/check-docs-fragments.mjs`. Same-file (`#x`) and cross-file (`file.md#x`) links
 * are both resolved, with headings slugged the way GitHub does. `DocsMarkdown`'s MD051 covers only
 * the same-file form, and `DocsLinks` ignores fragments; this closes that gap.
 *
 * Fails on any link whose fragment matches no heading or `<a id>` in the target, listing the
 * headings that exist. Fails when the scan itself errors. Never warns.
 *
 * Exceptions: none. Fix the link or the heading.
 *
 * Runs in the consumer `contract` job, in both git hooks, and in IPC's own self-contract.
 *
 * Limits: only inline `[text](target)` links are parsed, not reference-style ones. A target file
 * that does not exist is skipped here; that is `DocsLinks`' finding.
 */
import path from "node:path"
import type { CheckDefinitionConfig, PolicyResult } from "repo-contract"
import { packageRoot, parseToolEnvelope } from "./shared.js"

const scriptPath = path.join(packageRoot, "scripts", "check-docs-fragments.mjs")

interface BrokenFragment {
  readonly file: string
  readonly line: number
  readonly target: string
  readonly fragment: string
  readonly availableFragments: readonly string[]
}
interface FragmentReport {
  readonly ok: boolean
  readonly broken?: readonly BrokenFragment[]
  readonly error?: string
}

export const docsFragments: CheckDefinitionConfig = {
  run: ["node", scriptPath],
  output: { format: "json" },
  policy: ({ result }): PolicyResult => {
    const envelope = parseToolEnvelope<FragmentReport>(
      result,
      "check-docs-fragments",
      "Docs (fragments):",
    )
    if (!envelope.ok) return envelope.result

    const report = envelope.value
    if (!report.ok) {
      return {
        outcome: "fail",
        rationale: `Docs (fragments): scan failed: ${report.error ?? "unknown error"}.`,
      }
    }

    const broken = report.broken ?? []
    if (broken.length === 0) {
      return { outcome: "pass", rationale: "Docs (fragments): every local heading link resolves." }
    }

    return {
      outcome: "fail",
      rationale: [
        `Docs (fragments): ${String(broken.length)} broken heading link(s):`,
        ...broken.map((b) => {
          const closest =
            b.availableFragments.length > 0 ? b.availableFragments.join(", ") : "(no headings)"
          return `- ${b.file}:${String(b.line)} -- #${b.fragment} does not match any heading in ${b.target}. Available: ${closest}`
        }),
      ].join("\n"),
    }
  },
}
