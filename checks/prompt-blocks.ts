/**
 * `PromptBlocks`: no document still carries a question the scaffold left for its author.
 *
 * Reads: every `<!-- ipc:prompt: ... -->` in the package's documents and decision records, and
 * every `TODO:` value in `docs/surface.json`. Through `scripts/check-prompt-blocks.mjs` and
 * `scripts/prompts/scan.mjs`. Also `IPC_RELEASE` from the environment.
 *
 * Warns on an unanswered prompt during development: a question is normal on day one. Fails on one
 * when `IPC_RELEASE=1`, which the shared release workflow sets before it runs `--checks
 * PromptBlocks`. Judges that a prompt is gone, never whether the answer is good.
 *
 * Exceptions: none. Replace the whole comment with the answer.
 *
 * Runs in the consumer `contract` job and in both git hooks. The shared release workflow runs it
 * again. IPC's own self-contract leaves it out: this package has no scaffold prompts.
 */
import path from "node:path"
import type { CheckDefinitionConfig, PolicyResult } from "repo-contract"
import { packageRoot, parseToolEnvelope } from "./shared.js"

const scriptPath = path.join(packageRoot, "scripts", "check-prompt-blocks.mjs")

interface PromptReport {
  readonly ok: boolean
  readonly state?: "clean" | "open"
  readonly release?: boolean
  readonly open: readonly { readonly file: string; readonly line: number; readonly text: string }[]
}

/** @returns the `PromptBlocks` check. */
export function promptBlocksCheck(): CheckDefinitionConfig {
  return {
    run: ["node", scriptPath],
    output: { format: "json" },
    policy: ({ result }): PolicyResult => {
      const envelope = parseToolEnvelope<PromptReport>(
        result,
        "check-prompt-blocks",
        "PromptBlocks:",
      )
      if (!envelope.ok) return envelope.result
      const { state, release, open } = envelope.value
      if (state !== "open") {
        return {
          outcome: "pass",
          rationale: "PromptBlocks: no document still asks its author a question.",
        }
      }
      const list = open
        .map((prompt) => `- ${prompt.file}:${String(prompt.line)}: ${prompt.text}`)
        .join("\n")
      return {
        outcome: release === true ? "fail" : "warn",
        rationale: `PromptBlocks: ${String(open.length)} unanswered prompt(s)${release === true ? ", and a release is being verified" : ""}. Answer each by replacing its whole comment with the answer:\n${list}`,
      }
    },
  }
}
