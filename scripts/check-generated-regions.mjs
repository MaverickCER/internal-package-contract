// Entry point for the `GeneratedRegions` check (see checks/generated-regions.ts). Runs `generate
// --check` in this process (scripts/generate/run.mjs) with its output captured. Prints one JSON
// envelope. The state is `absent` when no document marks a region, and `current` when every region
// matches its sources. Otherwise it is `problem`, with what the command said. The policy decides
// the verdict.

import { run } from "./generate/run.mjs"

const cwd = process.cwd()
const messages = []
const notes = []
const code = await run(["--check"], cwd, {
  out: (text) => notes.push(text.trim()),
  err: (text) => messages.push(text.trim()),
})
process.stdout.write(
  JSON.stringify(
    code === 0
      ? {
          ok: true,
          state: notes.some((note) => note.includes("no generated regions")) ? "absent" : "current",
        }
      : { ok: true, state: "problem", message: messages.join("\n") },
  ),
)
