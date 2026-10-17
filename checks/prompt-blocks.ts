/**
 * Finds the questions a scaffold left for its author (`<!-- ipc:prompt: ... -->`) that nobody has answered.
 * While a package is being developed they are a warning, because an unanswered question is normal on day one.
 * When a release is being verified (`IPC_RELEASE=1`, set by the release workflow's own step) they fail, because
 * a released package must not ship a document that still asks what it is for. It checks that a prompt is
 * gone, never whether the answer is any good.
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
