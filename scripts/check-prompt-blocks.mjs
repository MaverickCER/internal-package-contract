// Entry point for the `PromptBlocks` check (see checks/prompt-blocks.ts). Finds every unanswered
// `<!-- ipc:prompt: ... -->` in the package's documents (scripts/prompts/scan.mjs) and prints one JSON
// envelope with them. It also reports whether `IPC_RELEASE=1` is set, which the policy reads to fail a
// release instead of warning. The policy decides the verdict.

import { scanPackage } from "./prompts/scan.mjs"

const open = scanPackage(process.cwd())
process.stdout.write(
  JSON.stringify({
    ok: true,
    state: open.length === 0 ? "clean" : "open",
    release: process.env["IPC_RELEASE"] === "1",
    open,
  }),
)
