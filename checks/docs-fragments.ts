/**
 * Broken-heading-fragment detection across a consumer's own hand-authored Markdown -- the
 * fragment-resolution gap neither existing docs check covers. See
 * {@link file://../scripts/check-docs-fragments.mjs} for the full rationale and the two
 * confirmed blind spots this closes: markdownlint's MD051 rule (`DocsMarkdown`) only resolves a
 * *bare* `#fragment` link, never a `filename.md#fragment` link even when `filename.md` is the
 * link's own file; linkinator (`DocsLinks`) does not meaningfully validate fragments at all.
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
