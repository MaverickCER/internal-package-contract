// Entry point for the `GeneratedRegions` check (see checks/generated-regions.ts). Prints one JSON envelope;
// never exits non-zero for a finding (policy decides).
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
