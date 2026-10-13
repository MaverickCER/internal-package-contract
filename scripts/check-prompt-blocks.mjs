// Entry point for the `PromptBlocks` check (see checks/prompt-blocks.ts). Prints one JSON envelope; never
// exits non-zero for a finding (policy decides).
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
