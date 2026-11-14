/**
 * `Prose`: no em-dash and no ` -- ` dash substitute in the prose the package writes.
 *
 * Reads: every tracked Markdown file outside code blocks, code spans and HTML comments; the comments in
 * TypeScript and JavaScript files; and full-line comments in YAML and shell files. Through
 * `scripts/check-prose.mjs` and `scripts/prose.mjs`. Code, strings and tool directives (ESLint's
 * `-- reason` syntax among them) are never read as prose.
 *
 * Fails on any such dash, listing the first 30 by `file:line`. Fails when the scan cannot list the
 * tracked files. Never warns.
 *
 * Exceptions: none. Use a period, colon, semicolon, comma or parentheses instead.
 *
 * Not read: `CHANGELOG.md` and decision records (history), `CODE_OF_CONDUCT.md` (third-party text),
 * declaration files, and anything under `node_modules` or a fixtures directory. Generated files are
 * not read either: `docs/api-report/`, `docs/api/`, `BENCHMARKS.md`, and any file whose first ten
 * lines say "GENERATED FILE", "Machine-generated", "@generated" or "do not edit by hand".
 *
 * Runs in the consumer `contract` job, in both git hooks, and in IPC's own self-contract.
 *
 * Limit: it judges one punctuation habit, not whether the writing is clear. Sentence length and the
 * rest of the writing rules stay a review concern.
 */
import path from "node:path"
import type { CheckDefinitionConfig, PolicyResult } from "repo-contract"
import { packageRoot, parseToolEnvelope } from "./shared.js"

const scriptPath = path.join(packageRoot, "scripts", "check-prose.mjs")
const MAX_LISTED = 30

interface ProseReport {
  readonly ok: boolean
  readonly files?: number
  readonly findings?: readonly { readonly file: string; readonly line: number }[]
  readonly error?: string
}

/** @returns the `Prose` check. */
export function proseCheck(): CheckDefinitionConfig {
  return {
    run: ["node", scriptPath],
    output: { format: "json" },
    policy: ({ result }): PolicyResult => {
      const envelope = parseToolEnvelope<ProseReport>(result, "check-prose", "Prose:")
      if (!envelope.ok) return envelope.result
      const report = envelope.value
      if (!report.ok) {
        return {
          outcome: "fail",
          rationale: `Prose: scan failed: ${report.error ?? "unknown error"}.`,
        }
      }
      const findings = report.findings ?? []
      if (findings.length === 0) {
        return {
          outcome: "pass",
          rationale: `Prose: no em-dash or " -- " in the prose of ${String(report.files ?? 0)} file(s).`,
        }
      }
      const listed = findings.slice(0, MAX_LISTED).map((f) => `- ${f.file}:${String(f.line)}`)
      const more = findings.length - listed.length
      return {
        outcome: "fail",
        rationale: [
          `Prose: ${String(findings.length)} line(s) use an em-dash or " -- " as punctuation. Use a period, colon, semicolon, comma or parentheses:`,
          ...listed,
          ...(more > 0 ? [`- ...and ${String(more)} more`] : []),
        ].join("\n"),
      }
    },
  }
}
